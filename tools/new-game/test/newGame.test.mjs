import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { defaultId, desktopToken, newGame, parseArgs, WRITTEN_FILES } from '../../new-game.mjs';

// The engine's own folder (this is tools/new-game/test/), from here.
const ENGINE = fileURLToPath(new URL('../../../', import.meta.url));
const read = (...parts) => readFileSync(join(...parts), 'utf8');
const json = (...parts) => JSON.parse(read(...parts));
const temp = () => mkdtempSync(join(tmpdir(), 'new-game-test-'));

/** Every file under `dir` as a `/`-separated path relative to it, sorted. */
function filesUnder(dir) {
  const found = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) walk(path);
      else found.push(relative(dir, path).split(sep).join('/'));
    }
  };
  walk(dir);
  return found.sort();
}

describe('a new game made from the empty game', () => {
  const target = join(temp(), 'game-two');
  const NAME = 'Game Two';
  let written;
  beforeAll(() => {
    written = newGame({ target, name: NAME, id: undefined, engineRoot: ENGINE });
  });

  it("holds every file of the empty game but its installs, its build and its tsconfig, and the four that are the game's own", () => {
    const empty = filesUnder(join(ENGINE, 'empty')).filter((path) => !/^(node_modules|dist)\//.test(path) && path !== 'tsconfig.json');
    expect(empty.length).toBeGreaterThan(10);
    expect(WRITTEN_FILES).toEqual(['.gitignore', 'README.md', 'package.json', 'tsconfig.json']);
    expect(filesUnder(target)).toEqual([...empty, '.gitignore', 'README.md', 'package.json', 'tsconfig.json'].sort());
    expect(written).toEqual(filesUnder(target));
  });

  it('installs the engine from the release of this checkout\'s version, with the dev tools of this checkout', () => {
    const mine = json(ENGINE, 'package.json');
    const pkg = json(target, 'package.json');
    const release = `https://github.com/csarkosh/engine/releases/download/v${mine.version}/csarkosh-engine-${mine.version}.tgz`;
    expect(pkg.name).toBe('game-two');
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe('module');
    expect(pkg.dependencies).toEqual({ '@csarkosh/engine': release });
    for (const tool of ['typescript', 'vite', 'vitest']) expect(pkg.devDependencies[tool]).toBe(mine.devDependencies[tool]);
    expect(pkg.devDependencies['@types/node']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.scripts).toEqual({ dev: 'vite', build: 'vite build', typecheck: 'tsc -p . --noEmit', test: 'vitest run' });
  });

  it('has a tsconfig of its own that reads the installed engine\'s environment types', () => {
    const config = json(target, 'tsconfig.json');
    expect(config.extends).toBeUndefined();
    expect(config.compilerOptions).toEqual(json(ENGINE, 'tsconfig.json').compilerOptions);
    expect(config.include).toEqual(['src', 'test', 'vite.config.ts', 'node_modules/@csarkosh/engine/src/env.d.ts']);
    expect(read(target, '.gitignore')).toBe('node_modules\ndist\n');
    expect(read(target, 'README.md')).toContain(`# ${NAME}`);
    expect(read(target, 'README.md')).toContain(json(ENGINE, 'package.json').version);
  });

  it('names the empty game nowhere: not its title, its storage key, its address or its environment variable', () => {
    const forbidden = [/The Empty Game/, /THE EMPTY GAME/, /<title>The empty game/, /"empty"/, /["'`]empty\./, /\/empty\//, /EMPTY_BASE/];
    for (const path of written) {
      const text = read(target, path);
      for (const pattern of forbidden) expect(text, `${path} against ${pattern}`).not.toMatch(pattern);
    }
  });

  it('holds the new identity, key, address and title in their places', () => {
    expect(read(target, 'src/page.ts')).toContain('identity: { title: "Game Two", session: "walk", player: "Walker", storage: "game-two", desktop: "GameTwo" },');
    expect(read(target, 'src/page.ts')).toContain('title.textContent = "GAME TWO";');
    expect(read(target, 'src/game.ts')).toContain('key: "game-two.mode",');
    expect(read(target, 'vite.config.ts')).toContain('base: process.env.GAME_BASE ?? "/game-two/",');
    expect(read(target, 'index.html')).toContain('<title>Game Two</title>');
    expect(read(target, 'test/game.test.ts')).toContain('startsWith("game-two.")');
  });

  it('leaves the empty game\'s own files as they were', () => {
    expect(read(ENGINE, 'empty/src/page.ts')).toContain('title: "The Empty Game"');
    expect(read(ENGINE, 'empty/vite.config.ts')).toContain('EMPTY_BASE');
  });
});

describe('a name and an id', () => {
  it('makes the id of the name, every run of other characters one hyphen, and the desktop token of its letters and digits', () => {
    expect(defaultId('Game Two')).toBe('game-two');
    expect(defaultId("  The Hiker's -- Trail!  ")).toBe('the-hiker-s-trail');
    expect(desktopToken("The Hiker's Trail")).toBe('TheHikersTrail');
  });

  it('takes an id and a name with characters that need escaping in the places they are written', () => {
    const target = join(temp(), 'quoted');
    newGame({ target, name: 'Tom & "Jerry" <3', id: 'tom', engineRoot: ENGINE });
    expect(read(target, 'index.html')).toContain('<title>Tom &amp; "Jerry" &lt;3</title>');
    expect(read(target, 'src/page.ts')).toContain('title: "Tom & \\"Jerry\\" <3"');
    expect(read(target, 'src/page.ts')).toContain('desktop: "TomJerry3"');
    expect(read(target, 'src/page.ts')).toContain('storage: "tom"');
  });

  it('refuses a bad id, and writes nothing', () => {
    for (const id of ['2x', 'Game', 'a_b', '-a', '', 'a b']) {
      const target = join(temp(), 'bad');
      expect(() => newGame({ target, name: 'Game Two', id, engineRoot: ENGINE }), id).toThrow(/id/);
      expect(() => readdirSync(target), id).toThrow();
    }
  });

  it('refuses a name that gives no id, no desktop token or a second line', () => {
    const target = join(temp(), 'bad');
    expect(() => newGame({ target, name: '2 Fast', engineRoot: ENGINE })).toThrow(/give one with --id/);
    expect(() => newGame({ target, name: '!!!', id: 'x', engineRoot: ENGINE })).toThrow(/desktop token/);
    expect(() => newGame({ target, name: 'A\nB', id: 'x', engineRoot: ENGINE })).toThrow(/--name/);
    expect(() => readdirSync(target)).toThrow();
  });
});

describe('the target folder', () => {
  it('takes one that is empty', () => {
    const target = temp();
    expect(newGame({ target, name: 'Game Two', engineRoot: ENGINE }).length).toBeGreaterThan(10);
  });

  it('refuses one that holds anything, names it and writes nothing into it', () => {
    const target = temp();
    mkdirSync(join(target, 'keep'));
    writeFileSync(join(target, 'keep', 'mine.txt'), 'mine');
    expect(() => newGame({ target, name: 'Game Two', engineRoot: ENGINE })).toThrow(target);
    expect(filesUnder(target)).toEqual(['keep/mine.txt']);
    expect(read(target, 'keep/mine.txt')).toBe('mine');
  });

  it('refuses a file', () => {
    const file = join(temp(), 'file');
    writeFileSync(file, 'x');
    expect(() => newGame({ target: file, name: 'Game Two', engineRoot: ENGINE })).toThrow(file);
    expect(read(file)).toBe('x');
  });
});

describe('the empty game it is made from', () => {
  /** A checkout of the engine in miniature: the files the script reads, with the empty game's text as given. */
  function checkout(change) {
    const root = temp();
    for (const path of ['package.json', 'tsconfig.json']) {
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, path), read(ENGINE, path));
    }
    for (const path of filesUnder(join(ENGINE, 'empty')).filter((p) => !/^(node_modules|dist)\//.test(p))) {
      const file = join(root, 'empty', path);
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, change(path, read(ENGINE, 'empty', path)));
    }
    return root;
  }

  it('is copied as it stands: the same text of a file the script renames nothing in', () => {
    const target = join(temp(), 'copy');
    newGame({ target, name: 'Game Two', engineRoot: ENGINE });
    expect(read(target, 'src/sim.ts')).toBe(read(ENGINE, 'empty/src/sim.ts'));
    expect(read(target, 'levels/yard.json')).toBe(read(ENGINE, 'empty/levels/yard.json'));
  });

  it('fails loudly, naming the file and the string, when a name it renames is gone or stands twice', () => {
    const gone = checkout((path, text) => (path === 'src/game.ts' ? text.replace('key: "empty.mode"', 'key: "walk.mode"') : text));
    expect(() => newGame({ target: join(temp(), 'a'), name: 'Game Two', engineRoot: gone })).toThrow(/src\/game\.ts.*key: \\"empty\.mode\\".*0 times/);
    const twice = checkout((path, text) => (path === 'vite.config.ts' ? `${text}\n// process.env.EMPTY_BASE ?? "/empty/"\n` : text));
    const target = join(temp(), 'b');
    expect(() => newGame({ target, name: 'Game Two', engineRoot: twice })).toThrow(/vite\.config\.ts.*EMPTY_BASE.*2 times/);
    expect(() => readdirSync(target)).toThrow();
  });
});

describe('the command line', () => {
  it('takes a folder, a name and an id, in either form', () => {
    expect(parseArgs(['out', '--name', 'Game Two'])).toEqual({ target: 'out', name: 'Game Two', id: undefined });
    expect(parseArgs(['--name=Game Two', 'out', '--id', 'g2'])).toEqual({ target: 'out', name: 'Game Two', id: 'g2' });
  });

  it('refuses a missing folder or name, an unknown option and a value left out', () => {
    expect(() => parseArgs(['--name', 'Game Two'])).toThrow(/usage/);
    expect(() => parseArgs(['out'])).toThrow(/usage/);
    expect(() => parseArgs(['out', '--name', 'x', '--force'])).toThrow(/unknown option --force/);
    expect(() => parseArgs(['out', '--name'])).toThrow(/--name needs a value/);
  });
});
