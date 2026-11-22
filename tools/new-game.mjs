#!/usr/bin/env node
// Starts a new game from the empty game (`npm run new-game -- <folder> --name "<The Game's Name>"`).
//
//   node tools/new-game.mjs <target folder> --name "<The Game's Name>" [--id <short-id>]
//
// Run from a checkout of this repository. It writes the empty game (`empty/`) into the target folder under
// the new game's own name, with a `package.json` that installs the engine from the release of this checkout's
// version, a standalone `tsconfig.json`, a `.gitignore` and a `README.md`. The target must not exist or must be
// empty; if it is not, nothing is written. The empty game's own files are not changed.
//
// The id is what the game keeps its browser storage under and what its page is served at (`/<id>/`). It
// defaults to the name in lower case, with every run of other characters made one hyphen.
//
// The logic is `newGame`, which takes the folders; the rest of this file reads the command line.
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** What the empty game has at its top that a new game does not take: its installs, its build and its own tsconfig. */
const NOT_COPIED = new Set(['node_modules', 'dist', 'tsconfig.json']);

/** The file a new game's TypeScript reads the engine's environment types from, once the engine is installed. */
const ENV_TYPES = 'node_modules/@csarkosh/engine/src/env.d.ts';

/** The files `newGame` writes that are not copies of the empty game's. */
export const WRITTEN_FILES = ['.gitignore', 'README.md', 'package.json', 'tsconfig.json'];

/**
 * The commands a new game starts with, as printed and as written into its README. A plain `npm install` of a
 * game with no lockfile fails in npm's own peer resolution (npm 10.9.9: "Cannot read properties of null
 * (reading 'edgesOut')"); `--legacy-peer-deps` installs it, and writes the game's lockfile.
 */
export const NEXT_STEPS = ['npm install --legacy-peer-deps', 'npm run dev'];

/**
 * The version of `@types/node` a new game's `devDependencies` hold besides the engine's three: the game's own
 * tests and Vite config, and the engine's `testing/` helpers it imports, use `node:` modules and `process`, and
 * with no lockfile npm installs no optional peer, so nothing else brings the types. It is the version the
 * engine's own lockfile checks the engine against.
 */
const NODE_TYPES = '26.1.1';

/** The npm scripts every new game has. */
const SCRIPTS = { dev: 'vite', build: 'vite build', typecheck: 'tsc -p . --noEmit', test: 'vitest run' };

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/** The id a name gives when none is asked for: lower case, every run of other characters one hyphen, trimmed of hyphens. */
export function defaultId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** The name with everything but letters and digits removed: the token the game's desktop app puts in its user agent. */
export function desktopToken(name) {
  return name.replace(/[^A-Za-z0-9]/g, '');
}

const htmlText = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Every place the empty game names itself, as exact strings in the copied text. Each must stand exactly once in
 * its file or `newGame` throws, naming the file and the string, so a change to the empty game cannot leave a name
 * behind unnoticed. The first four are the game's own files, the rest the tests copied beside them, which pin
 * some of those names.
 */
function renames({ name, id, desktop }) {
  const text = (value) => JSON.stringify(value);
  return [
    // The identity record (`session` and `player` stay as they are), the landing heading and the page's title.
    { file: 'src/page.ts', from: 'title: "The Empty Game"', to: `title: ${text(name)}` },
    { file: 'src/page.ts', from: 'storage: "empty"', to: `storage: ${text(id)}` },
    { file: 'src/page.ts', from: 'desktop: "EmptyGame"', to: `desktop: ${text(desktop)}` },
    { file: 'src/page.ts', from: 'title.textContent = "THE EMPTY GAME";', to: `title.textContent = ${text(name.toUpperCase())};` },
    { file: 'index.html', from: '<title>The empty game</title>', to: `<title>${htmlText(name)}</title>` },
    // The key its mode is kept under, and the address and the environment variable its build is served from.
    { file: 'src/game.ts', from: 'key: "empty.mode"', to: `key: ${text(`${id}.mode`)}` },
    { file: 'vite.config.ts', from: 'process.env.EMPTY_BASE ?? "/empty/"', to: `process.env.GAME_BASE ?? ${text(`/${id}/`)}` },
    // The tests that pin those names.
    { file: 'test/game.test.ts', from: 'WALK_MODES.key.startsWith("empty.")', to: `WALK_MODES.key.startsWith(${text(`${id}.`)})` },
    { file: 'test/game.test.ts', from: 'key: "empty.playerName"', to: `key: ${text(`${id}.playerName`)}` },
    { file: 'test/game.test.ts', from: 'expect(EMPTY_PAGE.identity.title).toBe("The Empty Game");', to: `expect(EMPTY_PAGE.identity.title).toBe(${text(name)});` },
    {
      file: 'test/game.test.ts',
      from: '["The Empty Game", "This browser cannot run The Empty Game.", "The Empty Game runs in:"]',
      to: `[${text(name)}, ${text(`This browser cannot run ${name}.`)}, ${text(`${name} runs in:`)}]`,
    },
  ];
}

/** Every file under `dir` as a `/`-separated path relative to it, sorted, with the top-level entries of `skip` left out. */
function filesUnder(dir, skip) {
  const found = [];
  const walk = (path, prefix) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (prefix === '' && skip.has(entry.name)) continue;
      if (entry.isDirectory()) walk(join(path, entry.name), `${prefix}${entry.name}/`);
      else found.push(`${prefix}${entry.name}`);
    }
  };
  walk(dir, '');
  return found.sort();
}

/** `text` with `from` replaced by `to`, where `from` must stand exactly once. */
function replaceOnce(file, text, from, to) {
  const parts = text.split(from);
  if (parts.length !== 2) {
    throw new Error(`new-game: ${file} holds ${JSON.stringify(from)} ${parts.length - 1} times, not once; the empty game has changed and this script's rename for it has to follow`);
  }
  return parts.join(to);
}

function readme({ name, version }) {
  return [
    `# ${name}`,
    '',
    `A game built on [\`@csarkosh/engine\`](https://github.com/csarkosh/engine) at release ${version}, started from the engine's empty game.`,
    '',
    '```',
    ...NEXT_STEPS,
    '```',
    '',
    'The first install needs `--legacy-peer-deps`: with no lockfile yet, npm (10.9.9 was tried) fails in its own peer resolution without it. It writes `package-lock.json`, after which a plain `npm install` works.',
    '',
    '| Script | What it does |',
    '| --- | --- |',
    '| `npm run dev` | Serves the game on a dev server. |',
    '| `npm run build` | Builds the game into `dist/`. |',
    '| `npm run typecheck` | `tsc` over the game. |',
    '| `npm test` | The game\'s tests. |',
    '',
  ].join('\n');
}

/**
 * Writes a new game into `target`, made from the empty game of the checkout at `engineRoot`, and returns the
 * paths it wrote (relative to `target`, sorted). Everything is checked and made in memory first; a refusal or a
 * failed rename throws before the target is touched.
 */
export function newGame({ target, name, id, engineRoot }) {
  if (typeof name !== 'string' || name.trim() === '' || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error('new-game: --name must be the game\'s name, on one line');
  }
  name = name.trim();
  id = id ?? defaultId(name);
  if (!ID_PATTERN.test(id)) {
    throw new Error(`new-game: the id ${JSON.stringify(id)} must start with a letter and hold only a-z, 0-9 and hyphens${id === defaultId(name) ? '; give one with --id' : ''}`);
  }
  const desktop = desktopToken(name);
  if (desktop === '') throw new Error(`new-game: the name ${JSON.stringify(name)} has no letter or digit to make the desktop token of`);

  const folder = resolve(target);
  if (existsSync(folder) && (!statSync(folder).isDirectory() || readdirSync(folder).length > 0)) {
    throw new Error(`new-game: ${folder} exists and is not an empty folder; give a folder that does not exist yet, or an empty one`);
  }

  const emptyGame = join(engineRoot, 'empty');
  const pkg = JSON.parse(readFileSync(join(engineRoot, 'package.json'), 'utf8'));
  const version = pkg.version;
  const dev = {};
  for (const dependency of ['typescript', 'vite', 'vitest']) {
    dev[dependency] = pkg.devDependencies?.[dependency];
    if (typeof dev[dependency] !== 'string') throw new Error(`new-game: ${join(engineRoot, 'package.json')} has no ${dependency} in its devDependencies`);
  }
  const { compilerOptions } = JSON.parse(readFileSync(join(engineRoot, 'tsconfig.json'), 'utf8'));

  /** What goes into the folder, by path: a copy of the empty game's file, or the game's own text. */
  const out = new Map();
  const renamed = renames({ name, id, desktop });
  for (const path of filesUnder(emptyGame, NOT_COPIED)) {
    const bytes = readFileSync(join(emptyGame, path));
    const mine = renamed.filter((rule) => rule.file === path);
    if (mine.length === 0) {
      out.set(path, bytes);
      continue;
    }
    let text = bytes.toString('utf8');
    for (const rule of mine) text = replaceOnce(path, text, rule.from, rule.to);
    out.set(path, text);
  }
  for (const rule of renamed) {
    if (!out.has(rule.file)) throw new Error(`new-game: the empty game has no ${rule.file}, which this script renames ${JSON.stringify(rule.from)} in`);
  }
  for (const path of WRITTEN_FILES) {
    if (out.has(path)) throw new Error(`new-game: the empty game has a ${path} of its own, which this script writes`);
  }

  const release = `https://github.com/csarkosh/engine/releases/download/v${version}/csarkosh-engine-${version}.tgz`;
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
  out.set('package.json', json({
    name: id,
    private: true,
    type: 'module',
    scripts: SCRIPTS,
    dependencies: { '@csarkosh/engine': release },
    devDependencies: { '@types/node': NODE_TYPES, ...dev },
  }));
  out.set('tsconfig.json', json({ compilerOptions, include: ['src', 'test', 'vite.config.ts', ENV_TYPES] }));
  out.set('.gitignore', 'node_modules\ndist\n');
  out.set('README.md', readme({ name, version }));

  const written = [...out.keys()].sort();
  for (const path of written) {
    const file = join(folder, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, out.get(path));
  }
  return written;
}

/** The command line: `<target> --name <name> [--id <id>]`, as `{ target, name, id }`; throws a line of usage for anything else. */
export function parseArgs(argv) {
  const usage = 'usage: node tools/new-game.mjs <target folder> --name "<The Game\'s Name>" [--id <short-id>]';
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const match = /^--(name|id)(?:=(.*))?$/.exec(arg);
    if (match) {
      const value = match[2] ?? argv[++i];
      if (value === undefined) throw new Error(`new-game: --${match[1]} needs a value\n${usage}`);
      options[match[1]] = value;
    } else if (arg.startsWith('-')) {
      throw new Error(`new-game: unknown option ${arg}\n${usage}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1 || options.name === undefined) throw new Error(usage);
  return { target: positional[0], name: options.name, id: options.id };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
  // The engine's checkout is found from this script, never from the working directory.
  const engineRoot = fileURLToPath(new URL('..', import.meta.url));
  let written;
  try {
    written = newGame({ ...args, engineRoot });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  const folder = resolve(args.target);
  process.stdout.write(`new-game: wrote ${written.length} files into ${folder}\n`);
  for (const path of written) process.stdout.write(`  ${path}\n`);
  process.stdout.write(`\nNext, in ${folder}:\n`);
  for (const step of NEXT_STEPS) process.stdout.write(`  ${step}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
