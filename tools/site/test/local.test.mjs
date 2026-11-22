import { createHash } from 'node:crypto';
import { symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { makeDir } from './helpers.mjs';
import { assertUniquePaths, listLocal, planFiles, readGzipped } from '../lib/local.mjs';

describe('planFiles', () => {
  it('serves every file under the path, with the SHA-256 of its gzipped bytes (level 9)', () => {
    const dir = makeDir({ 'index.html': '<p>hi</p>', 'assets/a/b.js': 'x'.repeat(5000) });
    const { files, skipped } = planFiles({ dir, path: '/capesorrow' });
    expect(files.map((f) => f.path)).toEqual(['/capesorrow/assets/a/b.js', '/capesorrow/index.html']);
    const gz = gzipSync(Buffer.from('<p>hi</p>'), { level: 9 });
    expect(files[1]).toMatchObject({ hash: createHash('sha256').update(gz).digest('hex'), size: gz.length, abs: join(dir, 'index.html') });
    expect(skipped).toEqual({ hidden: 0, maps: 0 });
  });

  it('skips names that begin with a dot (a folder with all it holds, counted once) and .map files, and counts them', () => {
    const dir = makeDir({ 'index.html': 'a', '.DS_Store': 'x', '.git/config': 'y', '.git/HEAD': 'z', 'a.js.map': 'm', 'sub/b.css.map': 'm', 'sub/.hidden': 'h', 'sub/b.css': 'c', 'mapped.map.js': 'k' });
    const { files, skipped } = planFiles({ dir, path: '/g' });
    expect(files.map((f) => f.path)).toEqual(['/g/index.html', '/g/mapped.map.js', '/g/sub/b.css']);
    expect(skipped).toEqual({ hidden: 3, maps: 2 });
  });

  it('refuses a folder that is missing or has no index.html', () => {
    expect(() => planFiles({ dir: join(tmpdir(), 'site-test-no-such-folder'), path: '/g' })).toThrow(/is not a folder/);
    expect(() => planFiles({ dir: makeDir({ 'main.html': 'a' }), path: '/g' })).toThrow(/no index\.html/);
    expect(() => planFiles({ dir: makeDir({ 'sub/index.html': 'a' }), path: '/g' })).toThrow(/no index\.html/);
  });

  it('serves the root folder\'s files at the top level, and refuses a subfolder there', () => {
    const dir = makeDir({ 'index.html': 'a' });
    const rootDir = makeDir({ 'index.html': 'root', 'robots.txt': 'r', '.hidden': 'h', 'x.map': 'm' });
    const { files, skipped } = planFiles({ dir, path: '/g', rootDir });
    expect(files.map((f) => f.path)).toEqual(['/g/index.html', '/index.html', '/robots.txt']);
    expect(skipped).toEqual({ hidden: 1, maps: 1 });
    expect(() => planFiles({ dir, path: '/g', rootDir: makeDir({ 'index.html': 'a', 'games/x.html': 'b' }) })).toThrow(/is a folder/);
    expect(() => planFiles({ dir, path: '/g', rootDir: join(tmpdir(), 'site-test-no-such-root') })).toThrow(/--root-dir .* is not a folder/);
  });

  it('refuses a symbolic link', () => {
    const dir = makeDir({ 'index.html': 'a', 'real.txt': 'b' });
    symlinkSync(join(dir, 'real.txt'), join(dir, 'link.txt'));
    expect(() => planFiles({ dir, path: '/g' })).toThrow(/symbolic link/);
  });
});

describe('assertUniquePaths', () => {
  it('refuses two local files that map to one site path', () => {
    expect(() => assertUniquePaths([{ path: '/a', abs: '/x/a' }, { path: '/b', abs: '/x/b' }])).not.toThrow();
    expect(() => assertUniquePaths([{ path: '/a', abs: '/x/a' }, { path: '/a', abs: '/y/a' }])).toThrow(/two local files would be served at \/a: \/x\/a and \/y\/a/);
  });
});

describe('listLocal', () => {
  it('lists in a fixed order whatever the disk\'s', () => {
    const dir = makeDir({ 'b.txt': '1', 'a.txt': '2', 'c/d.txt': '3', 'c/a.txt': '4' });
    expect(listLocal(dir).files.map((f) => f.rel)).toEqual(['a.txt', 'b.txt', 'c/a.txt', 'c/d.txt']);
  });
});

describe('readGzipped', () => {
  it('gives the bytes the hash was made of, and refuses a file that changed since', () => {
    const dir = makeDir({ 'index.html': 'one' });
    const [file] = planFiles({ dir, path: '/g' }).files;
    expect(createHash('sha256').update(readGzipped(file)).digest('hex')).toBe(file.hash);
    writeFileSync(join(dir, 'index.html'), 'two');
    expect(() => readGzipped(file)).toThrow(/changed while the deploy ran/);
  });
});
