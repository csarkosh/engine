import { describe, expect, it } from 'vitest';
import { compileRules, diffInventories, displayFile, groupInventory, groupName, isOwnFile, makerOf } from '../lib/inventory.mjs';
import { entries, inventory } from './fixture.mjs';

const MB = 1048576;

describe('which frame is the application own', () => {
  it('is any file that is not a package, and not the dev server own', () => {
    expect(isOwnFile('src/main.ts')).toBe(true);
    expect(isOwnFile('@fs/Users/dev/game/src/a.ts')).toBe(true);
    expect(isOwnFile('assets/index-Bx3k9aQz.js')).toBe(true);
    expect(isOwnFile('node_modules/@babylonjs/core/x.js')).toBe(false);
    expect(isOwnFile('node_modules/.vite/deps/renderer.js')).toBe(false);
    expect(isOwnFile('@vite/client')).toBe(false);
    expect(isOwnFile('@id/__x00__virtual')).toBe(false);
  });
  it('counts the engine, installed as a package, as the application own', () => {
    expect(isOwnFile('node_modules/@csarkosh/engine/src/game/forest.ts')).toBe(true);
    expect(isOwnFile('@fs/Users/dev/game/node_modules/@csarkosh/engine/src/a.ts')).toBe(true);
    expect(isOwnFile('node_modules/.vite/deps/@csarkosh_engine.js')).toBe(false);
  });
});

describe('displayFile', () => {
  it('cuts a dev server absolute path back to its src folder or its package', () => {
    expect(displayFile('@fs/Users/dev/game/src/town/parts.ts')).toBe('src/town/parts.ts');
    expect(displayFile('@fs/Users/dev/game/node_modules/@csarkosh/engine/src/a.ts')).toBe('node_modules/@csarkosh/engine/src/a.ts');
    expect(displayFile('@fs/Users/dev/other/file.ts')).toBe('other/file.ts');
  });
  it('takes the content hash out of a bundle name so two builds name it alike', () => {
    expect(displayFile('assets/index-Bx3k9aQz.js')).toBe('assets/index.js');
    expect(displayFile('assets/vendor-D4f_a9-1.mjs')).toBe('assets/vendor.mjs');
    expect(displayFile('src/main-client.js')).toBe('src/main-client.js');
  });
});

describe('makerOf', () => {
  it('is the innermost own frame, by file and function, no line', () => {
    expect(makerOf(entries[0].stack)).toEqual({ maker: 'src/town/parts.ts buildTown', own: true });
    expect(makerOf(entries[1].stack)).toEqual({ maker: 'node_modules/@csarkosh/engine/src/game/forest.ts makeForest', own: true });
  });
  it('falls back to the nearest frame with a name when none is own', () => {
    expect(makerOf(entries[4].stack)).toEqual({ maker: 'node_modules/.vite/deps/renderer.js createBuffer', own: false });
    expect(makerOf([{ fn: '', file: 'node_modules/x.js', line: 1 }, { fn: 'named', file: 'node_modules/y.js', line: 2 }]).maker).toBe('node_modules/y.js named');
    expect(makerOf([{ fn: '', file: 'node_modules/x.js', line: 1 }]).maker).toBe('node_modules/x.js (anonymous)');
  });
  it('says so when there is no stack', () => {
    expect(makerOf([])).toEqual({ maker: '(no stack)', own: false });
  });
  it('drops the words async and new and an alias from a function name', () => {
    expect(makerOf([{ fn: 'async load', file: 'src/a.ts', line: 1 }]).maker).toBe('src/a.ts load');
    expect(makerOf([{ fn: 'new Pool', file: 'src/a.ts', line: 1 }]).maker).toBe('src/a.ts Pool');
    expect(makerOf([{ fn: 'Object.make [as build]', file: 'src/a.ts', line: 1 }]).maker).toBe('src/a.ts Object.make');
  });
});

describe('groupInventory', () => {
  it('groups by kind and maker, largest first, and sums the totals from the entries', () => {
    const g = groupInventory(inventory);
    expect(g.totals).toEqual({ bufferBytes: 6 * MB, textureBytes: 11 * MB, bytes: 17 * MB, count: 11 });
    expect(g.groups.map((x) => [x.name, x.bytes / MB, x.count])).toEqual([
      ['texture @ src/render/post.ts setup', 7, 1],
      ['buffer @ src/town/parts.ts buildTown', 4, 4],
      ['texture @ src/models/load.ts loadModel', 3, 3],
      ['buffer @ node_modules/@csarkosh/engine/src/game/forest.ts makeForest', 2, 2],
      ['texture @ node_modules/.vite/deps/renderer.js createBuffer', 1, 1],
    ]);
  });
  it('groups by kind alone', () => {
    expect(groupInventory(inventory, { by: 'kind' }).groups.map((x) => [x.name, x.bytes / MB])).toEqual([['texture', 11], ['buffer', 6]]);
  });
  it('groups by label and format, saying (no label) where there is none', () => {
    const names = groupInventory(inventory, { by: 'label' }).groups.map((x) => x.name);
    expect(names).toContain('texture scene rgba16float');
    expect(names).toContain('texture (no label) bc7-rgba-unorm');
    expect(names).toContain('buffer vertices');
  });
  it('groups by all of them with full', () => {
    expect(groupInventory(inventory, { by: 'full' }).groups.map((x) => x.name)).toContain('texture scene rgba16float @ src/render/post.ts setup');
  });
  it('lets a rules file win, in order, naming the group', () => {
    const rules = compileRules([
      { name: 'post', stack: 'post\\.ts' },
      { name: 'town', stack: 'town/' },
      { name: 'compressed', kind: 'texture', format: '^bc' },
      { name: 'all buffers', kind: 'buffer' },
    ]);
    const g = groupInventory(inventory, { rules });
    expect(g.groups.map((x) => [x.name, x.bytes / MB])).toEqual([
      ['post', 7],
      ['town', 4],
      ['compressed', 3],
      ['all buffers', 2],
      ['texture @ node_modules/.vite/deps/renderer.js createBuffer', 1],
    ]);
  });
  it('matches a rule on the label and on the size of one object', () => {
    const rules = compileRules([{ name: 'big', minBytes: 5 * MB }, { name: 'verts', label: '^vert' }, { name: 'small', maxBytes: MB / 2 }]);
    expect(groupName(entries[2], 'maker', rules)).toBe('big');
    expect(groupName(entries[0], 'maker', rules)).toBe('verts');
    // each object of the engine's forest buffers is 1 MB: neither big nor small
    expect(groupName(entries[1], 'maker', rules)).toBe('buffer @ node_modules/@csarkosh/engine/src/game/forest.ts makeForest');
    expect(groupName({ ...entries[1], bytes: 1000, count: 4 }, 'maker', rules)).toBe('small');
  });
  it('says what is wrong with an inventory that has no entries', () => {
    expect(() => groupInventory({})).toThrow(/gpu.entries is missing/);
    expect(() => groupInventory({ gpu: { available: false } })).toThrow(/no WebGPU/);
  });
});

describe('compileRules', () => {
  it('refuses what it cannot read, naming the rule', () => {
    expect(() => compileRules({})).toThrow(/list of rules/);
    expect(() => compileRules([{ label: 'a' }])).toThrow(/rule 1: needs a name/);
    expect(() => compileRules([{ name: 'x', colour: 1 }])).toThrow(/rule 1 \(x\): unknown key colour/);
    expect(() => compileRules([{ name: 'x', kind: 'image' }])).toThrow(/kind is/);
    expect(() => compileRules([{ name: 'x', label: '(' }])).toThrow(/label is not a regular expression/);
    expect(() => compileRules([{ name: 'x', minBytes: -1 }])).toThrow(/minBytes/);
  });
});

describe('diffInventories', () => {
  const after = structuredClone(inventory);
  // The town buffers shrink by 1 MB, the scene target is gone, a new group appears, a texture group grows.
  after.gpu.entries[0].bytes -= MB;
  after.gpu.entries.splice(2, 1);
  after.gpu.entries.push({ kind: 'texture', label: 'bloom', format: 'rgba8unorm', dims: '640x360', usage: 20, bytes: MB / 2, count: 1, stack: [{ fn: 'bloom', file: 'src/render/bloom.ts', line: 2 }] });
  after.gpu.entries[2].bytes += 2 * MB;
  after.processes[2].footprintMB = 550;

  it('gives the totals before, after and the difference', () => {
    const d = diffInventories(inventory, after);
    expect(d.before.bytes).toBe(17 * MB);
    expect(d.after.bytes).toBe(17 * MB - MB - 7 * MB + MB / 2 + 2 * MB);
    expect(d.delta.bytes).toBe(d.after.bytes - d.before.bytes);
    expect(d.browser.before.gpu).toBe(600);
    expect(d.browser.after.gpu).toBe(550);
    expect(d.browser.after.pageHeap).toBe(80);
  });
  it('lists each changed group by the size of its change, marking new and gone ones', () => {
    const d = diffInventories(inventory, after);
    expect(d.groups.map((g) => [g.name, g.delta / MB, g.status])).toEqual([
      ['texture @ src/render/post.ts setup', -7, 'gone'],
      ['texture @ src/models/load.ts loadModel', 2, 'changed'],
      ['buffer @ src/town/parts.ts buildTown', -1, 'changed'],
      ['texture @ src/render/bloom.ts bloom', 0.5, 'new'],
    ]);
    expect(d.groups[3]).toMatchObject({ beforeBytes: 0, afterBytes: MB / 2, beforeCount: 0, afterCount: 1 });
  });
  it('leaves out a group that did not change, so one build against itself is empty', () => {
    const d = diffInventories(inventory, structuredClone(inventory));
    expect(d.groups).toEqual([]);
    expect(d.delta).toEqual({ bufferBytes: 0, textureBytes: 0, bytes: 0, count: 0 });
  });
  it('notices a group whose bytes held but whose objects changed in number', () => {
    const more = structuredClone(inventory);
    more.gpu.entries[0].count = 8;
    expect(diffInventories(inventory, more).groups.map((g) => [g.beforeCount, g.afterCount])).toEqual([[4, 8]]);
  });
  it('groups both sides the same way, rules included', () => {
    const rules = compileRules([{ name: 'textures', kind: 'texture' }]);
    const d = diffInventories(inventory, after, { by: 'kind', rules });
    expect(d.groups.map((g) => g.name)).toEqual(['textures', 'buffer']);
  });
});
