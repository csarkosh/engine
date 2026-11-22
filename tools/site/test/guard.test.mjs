import { describe, expect, it } from 'vitest';
import { checkNewVersion, describeProblems } from '../lib/guard.mjs';

const owner = { path: '/capesorrow', root: false };
const f = (path, hash) => ({ path, hash });

const liveFiles = [f('/index.html', 'r1'), f('/dayhike/a.js', 'd1'), f('/dayhike/b.js', 'd2'), f('/capesorrow/old.js', 'o1'), f('/capesorrow/a.js', 'c1')];
const planned = [f('/capesorrow/a.js', 'c2'), f('/capesorrow/new.js', 'n1')];
const whole = [f('/index.html', 'r1'), f('/dayhike/a.js', 'd1'), f('/dayhike/b.js', 'd2'), ...planned];

describe('checkNewVersion', () => {
  it('finds nothing wrong with a version that holds the others\' files, the planned files and nothing else of this deploy\'s', () => {
    expect(checkNewVersion({ liveFiles, newFiles: whole, planned, owner })).toEqual([]);
  });
  it('finds a file of another game that is missing or changed', () => {
    const missing = whole.filter((x) => x.path !== '/dayhike/a.js');
    expect(checkNewVersion({ liveFiles, newFiles: missing, planned, owner })).toEqual(['/dayhike/a.js of another game is missing from the new version']);
    const changed = whole.map((x) => (x.path === '/index.html' ? f('/index.html', 'zz') : x));
    expect(checkNewVersion({ liveFiles, newFiles: changed, planned, owner })).toEqual(['/index.html of another game has changed in the new version']);
  });
  it('finds a planned file that is missing or has another hash', () => {
    const missing = whole.filter((x) => x.path !== '/capesorrow/new.js');
    expect(checkNewVersion({ liveFiles, newFiles: missing, planned, owner })).toEqual(['/capesorrow/new.js is missing from the new version']);
    const wrong = whole.map((x) => (x.path === '/capesorrow/a.js' ? f('/capesorrow/a.js', 'c1') : x));
    expect(checkNewVersion({ liveFiles, newFiles: wrong, planned, owner })).toEqual(['/capesorrow/a.js is in the new version with another hash than the one sent']);
  });
  it('finds a file of this deploy\'s in the new version that is not planned (the clone kept what it should have left out)', () => {
    const extra = [...whole, f('/capesorrow/old.js', 'o1')];
    expect(checkNewVersion({ liveFiles, newFiles: extra, planned, owner })).toEqual(['/capesorrow/old.js is in the new version, and this deploy does not serve it']);
  });
  it('takes the top-level files as another game\'s unless the deploy owns the root', () => {
    const gone = whole.filter((x) => x.path !== '/index.html');
    expect(checkNewVersion({ liveFiles, newFiles: gone, planned, owner })).toHaveLength(1);
    // The root's owner replaces them: a top-level file left over is a problem, one that is gone is not.
    const rootOwner = { path: '/capesorrow', root: true };
    expect(checkNewVersion({ liveFiles, newFiles: gone, planned, owner: rootOwner })).toEqual([]);
    expect(checkNewVersion({ liveFiles, newFiles: whole, planned, owner: rootOwner })).toEqual(['/index.html is in the new version, and this deploy does not serve it']);
  });
  it('reports every problem', () => {
    expect(checkNewVersion({ liveFiles, newFiles: [], planned, owner })).toHaveLength(5);
  });
});

describe('describeProblems', () => {
  it('lists up to twenty and counts the rest', () => {
    const problems = Array.from({ length: 25 }, (_, i) => `p${i}`);
    const text = describeProblems(problems);
    expect(text).toMatch(/^25 problems/);
    expect(text).toContain('p19');
    expect(text).not.toContain('p20');
    expect(text).toContain('... and 5 more');
    expect(describeProblems(['x'])).toMatch(/^1 problem with/);
  });
});
