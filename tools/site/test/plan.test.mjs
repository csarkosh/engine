import { describe, expect, it } from 'vitest';
import { describeRule, diffFiles, listPaths, planLines, ruleLines } from '../lib/plan.mjs';

const f = (path, hash) => ({ path, hash });
const game = { path: '/capesorrow', root: false };

describe('diffFiles', () => {
  const liveFiles = [f('/index.html', 'r'), f('/dayhike/a', 'd'), f('/capesorrow/same', 's'), f('/capesorrow/edit', 'e1'), f('/capesorrow/gone', 'g'), f('/capesorrow/also-gone', 'h')];
  const planned = [f('/capesorrow/same', 's'), f('/capesorrow/edit', 'e2'), f('/capesorrow/fresh', 'n')];
  it('counts the planned files as new, changed and unchanged, lists the owned live files that are gone, and counts the others\'', () => {
    expect(diffFiles({ liveFiles, planned, owner: game })).toEqual({
      added: ['/capesorrow/fresh'],
      changed: ['/capesorrow/edit'],
      unchanged: ['/capesorrow/same'],
      removed: ['/capesorrow/also-gone', '/capesorrow/gone'],
      kept: 2,
    });
  });
  it('counts the top-level files as the others\' for a game and as its own for the root\'s owner', () => {
    expect(diffFiles({ liveFiles, planned: [], owner: { ...game, root: true } })).toMatchObject({ removed: ['/capesorrow/also-gone', '/capesorrow/edit', '/capesorrow/gone', '/capesorrow/same', '/index.html'], kept: 1 });
  });
});

describe('rules in the plan', () => {
  const live = { rewrites: [{ glob: '/dayhike/**', path: '/dayhike/index.html' }, { glob: '/capesorrow/old/**', path: '/capesorrow/index.html' }, { glob: '**', path: '/index.html' }] };
  const merged = { rewrites: [{ glob: '/dayhike/**', path: '/dayhike/index.html' }, { glob: '/capesorrow/**', path: '/capesorrow/index.html' }, { glob: '**', path: '/index.html' }] };
  it('marks the rules the deploy adds and removes and leaves the others blank', () => {
    expect(ruleLines(live, merged)).toEqual([
      '  rewrites:',
      '      /dayhike/** -> /dayhike/index.html',
      '    + /capesorrow/** -> /capesorrow/index.html',
      '      ** -> /index.html',
      '    - /capesorrow/old/** -> /capesorrow/index.html',
    ]);
  });
  it('says nothing of a list with no rules before or after', () => {
    expect(ruleLines({}, {})).toEqual([]);
  });
  it('describes each kind of rule in a line', () => {
    expect(describeRule('redirects', { glob: '/a', statusCode: 302, location: '/b' })).toBe('302 /a -> /b');
    expect(describeRule('redirects', { regex: '^/a$', statusCode: 301, location: '/b' })).toBe('301 regex ^/a$ -> /b');
    expect(describeRule('headers', { glob: '**', headers: { A: '1', B: '2' } })).toBe('**: A: 1; B: 2');
  });
  it('lists up to twenty paths and counts the rest', () => {
    expect(listPaths(['/a', '/b'])).toEqual(['    /a', '    /b']);
    const lines = listPaths(Array.from({ length: 23 }, (_, i) => `/p${i}`));
    expect(lines).toHaveLength(21);
    expect(lines.at(-1)).toBe('    ... and 3 more');
  });
  it('puts the plan together', () => {
    const lines = planLines({
      live: 'sites/g/versions/1',
      liveFileCount: 7,
      diff: { added: ['/a'], changed: [], unchanged: ['/b', '/c'], removed: ['/x'], kept: 3 },
      skipped: { hidden: 1, maps: 2 },
      liveConfig: live,
      mergedConfig: merged,
    });
    expect(lines.slice(0, 7)).toEqual([
      'live version sites/g/versions/1: 7 files',
      "this deploy's files: 1 new, 0 changed, 2 unchanged",
      'skipped on disk: 1 hidden, 2 .map',
      'removed from the site: 1',
      '    /x',
      'files of others kept: 3',
      'rules after the deploy (+ added, - removed):',
    ]);
  });
});
