import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Facts about the engine's modules, computed from the engine's own `src/` as a test runs: which modules there
 * are, what each loads, and so which reach the terrain, which load no Babylon at all and which load no Babylon.js.
 * A game's architecture test holds its own imports of `@csarkosh/engine/<path>` to these, so a game that imports
 * a module the engine has needs no release of the engine to say so. A module is named by its path under `src/`
 * without the extension (`"shell"`, `"game/lite/renderer"`, `"sim/terrain"`).
 *
 * "Loads" is what the build loads: an import or a re-export that is not a type's (a type's is erased), and a
 * dynamic `import("...")`. A worker's entry named by `new Worker(new URL("./x.worker.ts", import.meta.url))` is
 * not loaded by the module that starts it: it is a thread of its own, and a rule about a worker reads the
 * worker's own module.
 *
 * They are read from this module's own location, so they are right whether the engine is the folder beside the
 * game or an installed package.
 */

const SRC = fileURLToPath(new URL("../src", import.meta.url));

/** The package the engine's Babylon Lite is, which draws the world and is not Babylon.js. */
const LITE = "@babylonjs/lite";
const BABYLON = "@babylonjs/";

/** The engine's module of a file under `src/`: its path without the extension, `/`-separated. */
function moduleOf(file: string): string {
  return relative(SRC, file).split(sep).join(posix.sep).replace(/\.ts$/, "");
}

function fileOf(module: string): string {
  return join(SRC, `${module}.ts`);
}

/** Source text without its `/* ... *\/` and `// ...` comments, so that an import named in prose is none. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, "");
}

/** Every `.ts` file under a folder but the declaration files (`.d.ts`). */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) found.push(full);
  }
  return found;
}

let modules: string[] | null = null;

/**
 * Every module of the engine, sorted: each `.ts` file under `src/` (the declaration files are none). A game's
 * test reads it as the modules its page may import, which is all of them.
 */
export function engineModules(): string[] {
  modules ??= sourceFiles(SRC).map(moduleOf).sort();
  return modules;
}

/** What one module loads: the specifiers of its value imports, re-exports and dynamic imports, in order, with no query. */
const specifiers = new Map<string, string[]>();

function loadedSpecifiers(module: string): string[] {
  const known = specifiers.get(module);
  if (known !== undefined) return known;
  const file = fileOf(module);
  if (!existsSync(file)) throw new Error(`"${module}" is no module of the engine: there is no src/${module}.ts`);
  const text = withoutComments(readFileSync(file, "utf8"));
  const found = [
    ...[...text.matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1] as string),
    ...[...text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] as string),
  ].map((spec) => spec.replace(/\?.*$/, ""));
  specifiers.set(module, found);
  return found;
}

/** A relative specifier of a module, as the engine's module it names (null for a package's or a file that is not a module). */
function resolved(module: string, spec: string): string | null {
  if (!spec.startsWith(".") || !spec.endsWith(".js")) return null;
  const target = posix.join(posix.dirname(module), spec.replace(/\.js$/, ""));
  if (!existsSync(fileOf(target))) throw new Error(`"${module}" imports "${spec}", which is no module of the engine`);
  return target;
}

/**
 * The engine's modules that one module imports by value, sorted and without repeats: not what it imports as a
 * type. A game's test reads it as the first step of what a module of the engine brings with it.
 */
export function valueImports(module: string): string[] {
  const named = loadedSpecifiers(module).map((spec) => resolved(module, spec)).filter((m): m is string => m !== null);
  return [...new Set(named)].sort();
}

/**
 * The packages one module imports by value (`"@babylonjs/lite"`), sorted and without repeats: every specifier
 * that is not a path of the engine's own. A game's test reads it for what a module needs installed.
 */
export function packageImports(module: string): string[] {
  const named = loadedSpecifiers(module).filter((spec) => !spec.startsWith("."));
  return [...new Set(named)].sort();
}

const reached = new Map<string, Set<string>>();

/**
 * The modules in a module's graph of value imports, the module itself included: everything loading it brings
 * along. A game's test reads it to ask what a page or a thread of the game loads of the engine.
 */
export function reaches(module: string): Set<string> {
  const known = reached.get(module);
  if (known !== undefined) return known;
  const seen = new Set<string>();
  const stack = [module];
  while (stack.length > 0) {
    const next = stack.pop() as string;
    if (seen.has(next)) continue;
    seen.add(next);
    stack.push(...valueImports(next));
  }
  reached.set(module, seen);
  return seen;
}

const reachedPackages = new Map<string, Set<string>>();

/** The packages imported by value anywhere in a module's graph (`reaches`), as a set. */
export function packagesReached(module: string): Set<string> {
  const known = reachedPackages.get(module);
  if (known !== undefined) return known;
  const found = new Set<string>();
  for (const member of reaches(module)) for (const spec of packageImports(member)) found.add(spec);
  reachedPackages.set(module, found);
  return found;
}

/**
 * The modules whose graph reaches the engine's terrain (`sim/terrain`), itself included, sorted. The engine's
 * terrain registers nothing of its own, so a thread of a game that loads one of these needs the game's
 * registration of its world first: a game's test holds each such thread to that.
 */
export function terrainModules(): string[] {
  return engineModules().filter((module) => reaches(module).has("sim/terrain"));
}

/**
 * The modules whose graph imports no package of Babylon at all, Babylon Lite included, sorted: the ones a game's
 * computing modules (poses, files, scenes, endings) may import and still load nothing that draws. A game's test
 * holds those modules' imports of the engine to these.
 */
export function pureModules(): string[] {
  return engineModules().filter((module) => [...packagesReached(module)].every((spec) => !spec.startsWith(BABYLON)));
}

/**
 * The modules whose graph imports no package of Babylon.js, sorted: Babylon Lite is allowed, and is the only
 * one of the `@babylonjs/` packages the engine uses. A game's test holds its page to loading no Babylon.js
 * with these.
 */
export function babylonFreeModules(): string[] {
  return engineModules().filter((module) => [...packagesReached(module)].every((spec) => !spec.startsWith(BABYLON) || spec === LITE));
}
