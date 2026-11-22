import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deploy } from '../lib/deploy.mjs';
import { loadRules } from '../lib/rules.mjs';
import { FakeHosting, hashOf } from './fakeHosting.mjs';
import { makeDir } from './helpers.mjs';

// The site two games already share: Day Hike under /dayhike, and the root's files and rules (the games page
// and the catch-alls). The config is the one the rules tests use.
const LIVE_CONFIG = {
  headers: [
    { glob: '**', headers: { 'Cache-Control': 'no-cache' } },
    { glob: '/dayhike/assets/**', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } },
  ],
  redirects: [
    { glob: '/', statusCode: 301, location: 'https://csarko.sh/games' },
    { glob: '/dayhike/admin', statusCode: 301, location: 'https://admin.csarko.sh/game-dayhike/' },
    { glob: '/dayhike/admin/**', statusCode: 301, location: 'https://admin.csarko.sh/game-dayhike/' },
  ],
  rewrites: [
    { glob: '/dayhike/**', path: '/dayhike/index.html' },
    { glob: '**', path: '/index.html' },
  ],
  cleanUrls: true,
};
const SITE_FILES = {
  '/index.html': 'games page',
  '/favicon.ico': 'icon',
  '/dayhike/index.html': 'dayhike page',
  '/dayhike/assets/a.js': 'dayhike code',
};
const TOKEN = 'tok-secret';

function site() {
  const fake = new FakeHosting({ token: TOKEN });
  fake.seed(SITE_FILES, LIVE_CONFIG);
  return fake;
}

/** Runs the deploy against a fake; `lines` and `sleeps` are what it logged and slept. */
function run(fake, options) {
  const lines = [];
  const sleeps = [];
  const promise = deploy({
    fetch: options.fetch ?? fake.fetch,
    token: TOKEN,
    log: (line) => lines.push(line),
    sleep: async (ms) => void sleeps.push(ms),
    project: 'proj-1',
    site: 'games',
    path: '/capesorrow',
    ...options,
  });
  return Object.assign(promise, { lines, sleeps });
}

const hashes = (files) => Object.fromEntries(Object.entries(files).map(([path, content]) => [path, hashOf(content)]));
const CAPE_RULES = {
  rewrites: [{ glob: '/capesorrow/**', path: '/capesorrow/index.html' }],
  headers: [{ glob: '/capesorrow/assets/**', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } }],
};

describe("a second game's first deploy", () => {
  it('keeps every file of the first game and the top level with their hashes, adds its own, and puts its rules before the root\'s catch-alls', async () => {
    const fake = site();
    const before = fake.liveFiles();
    const dir = makeDir({ 'index.html': 'cape page', 'assets/m.js': 'cape code', '.DS_Store': 'x', 'assets/m.js.map': '{}' });
    const run1 = run(fake, { dir, rules: CAPE_RULES, message: 'cape one' });
    const result = await run1;
    expect(fake.liveFiles()).toEqual({ ...before, ...hashes({ '/capesorrow/index.html': 'cape page', '/capesorrow/assets/m.js': 'cape code' }) });
    expect(result).toMatchObject({ released: true, counts: { added: 2, changed: 0, unchanged: 0, removed: 0, kept: 4 } });
    expect(fake.releases.at(-1)).toMatchObject({ channel: 'live', version: result.version, message: 'cape one' });
    const config = fake.liveVersion().config;
    expect(config.rewrites.map((r) => r.glob)).toEqual(['/dayhike/**', '/capesorrow/**', '**']);
    expect(config.headers.map((r) => r.glob)).toEqual(['**', '/dayhike/assets/**', '/capesorrow/assets/**']);
    expect(config.redirects).toEqual([LIVE_CONFIG.redirects[1], LIVE_CONFIG.redirects[2], LIVE_CONFIG.redirects[0]]);
    expect(config.cleanUrls).toBe(true);
    // The clone leaves out this game's path; the poll is every 1.5 s; the two new files are all that is uploaded.
    expect(fake.calls.find((c) => c.path.endsWith('versions:clone')).body).toEqual({ sourceVersion: 'sites/games/versions/1', finalize: false, exclude: { regexes: ['^/capesorrow/.*$'] } });
    expect(run1.sleeps).toEqual([1500]);
    expect(fake.uploads.sort()).toEqual([hashOf('cape page'), hashOf('cape code')].sort());
    expect(run1.lines.join('\n')).toContain('skipped on disk: 1 hidden, 1 .map');
  });
});

describe('a redeploy', () => {
  it('removes a file that is gone locally and uploads only what changed', async () => {
    const fake = site();
    await run(fake, { dir: makeDir({ 'index.html': 'v1', 'old.js': 'old', 'keep.js': 'keep' }) });
    fake.uploads.length = 0;
    const dir = makeDir({ 'index.html': 'v2', 'keep.js': 'keep', 'new.js': 'new' });
    const result = await run(fake, { dir });
    expect(result.counts).toEqual({ added: 1, changed: 1, unchanged: 1, removed: 1, kept: 4 });
    expect(fake.liveFiles()).toEqual({ ...hashes(SITE_FILES), ...hashes({ '/capesorrow/index.html': 'v2', '/capesorrow/keep.js': 'keep', '/capesorrow/new.js': 'new' }) });
    expect(fake.uploads.sort()).toEqual([hashOf('v2'), hashOf('new')].sort());
  });

  it('gives the same live config and files when nothing changed', async () => {
    const fake = site();
    const dir = makeDir({ 'index.html': 'v1' });
    await run(fake, { dir, rules: CAPE_RULES });
    const config = structuredClone(fake.liveVersion().config);
    const files = fake.liveFiles();
    fake.uploads.length = 0;
    const result = await run(fake, { dir, rules: CAPE_RULES });
    expect(fake.liveVersion().config).toEqual(config);
    expect(fake.liveFiles()).toEqual(files);
    expect(fake.uploads).toEqual([]);
    expect(result.counts).toMatchObject({ added: 0, changed: 0, unchanged: 1, removed: 0 });
  });

  it('removes a rule that is gone from the rules file', async () => {
    const fake = site();
    const dir = makeDir({ 'index.html': 'v1' });
    await run(fake, { dir, rules: CAPE_RULES });
    await run(fake, { dir, rules: { rewrites: CAPE_RULES.rewrites } });
    expect(fake.liveVersion().config.headers.map((r) => r.glob)).toEqual(['**', '/dayhike/assets/**']);
  });
});

describe("the root's owner's deploy", () => {
  it('replaces the top-level files and the root\'s rules, and leaves the other game alone', async () => {
    const fake = site();
    const dir = makeDir({ 'index.html': 'cape page' });
    const rootDir = makeDir({ 'index.html': 'new games page', 'robots.txt': 'robots', '.hidden': 'x' });
    const rules = { redirects: [{ glob: '/', statusCode: 302, location: 'https://csarko.sh/play' }], rewrites: [{ glob: '**', path: '/index.html' }] };
    const result = await run(fake, { dir, rootDir, rules });
    expect(fake.liveFiles()).toEqual({
      ...hashes({ '/dayhike/index.html': 'dayhike page', '/dayhike/assets/a.js': 'dayhike code' }),
      ...hashes({ '/index.html': 'new games page', '/robots.txt': 'robots', '/capesorrow/index.html': 'cape page' }),
    });
    expect(result.counts).toMatchObject({ added: 2, changed: 1, removed: 1, kept: 2 });
    expect(fake.calls.find((c) => c.path.endsWith('versions:clone')).body.exclude.regexes).toEqual(['^/capesorrow/.*$', '^/[^/]+$']);
    const config = fake.liveVersion().config;
    expect(config.redirects).toEqual([LIVE_CONFIG.redirects[1], LIVE_CONFIG.redirects[2], { glob: '/', statusCode: 302, location: 'https://csarko.sh/play' }]);
    expect(config.rewrites.map((r) => r.glob)).toEqual(['/dayhike/**', '**']);
    // The root's `**` header was the root's and is gone with the rest of its rules; the other game's stays.
    expect(config.headers).toEqual([LIVE_CONFIG.headers[1]]);
  });
});

describe('a channel release', () => {
  it('leaves live untouched, makes the channel with the expiry, and gives the address', async () => {
    const fake = site();
    const live = fake.liveVersion().name;
    const liveBefore = fake.liveFiles();
    const dir = makeDir({ 'index.html': 'preview' });
    const result = await run(fake, { dir, channel: 'try-1', expiresDays: 3 });
    expect(fake.liveVersion().name).toBe(live);
    expect(fake.liveFiles()).toEqual(liveBefore);
    expect(fake.releases.filter((r) => r.channel === 'live')).toHaveLength(1);
    expect(fake.channels.get('try-1').ttl).toBe('259200s');
    expect(fake.channelFiles('try-1')).toEqual({ ...liveBefore, ...hashes({ '/capesorrow/index.html': 'preview' }) });
    expect(result.address).toBe('https://games--try-1-abc123.web.app/capesorrow');
    // No check of the live version is made for a channel: it cannot be wiped by one.
    expect(fake.calls.filter((c) => c.path.endsWith('channels/live'))).toHaveLength(1);
  });

  it('releases to a channel that exists already, and reads its address', async () => {
    const fake = site();
    const dir = makeDir({ 'index.html': 'preview' });
    await run(fake, { dir, channel: 'try-1' });
    const again = await run(fake, { dir: makeDir({ 'index.html': 'preview 2' }), channel: 'try-1' });
    expect(again.address).toBe('https://games--try-1-abc123.web.app/capesorrow');
    expect(fake.releases.filter((r) => r.channel === 'try-1')).toHaveLength(2);
  });
});

describe('--dry-run', () => {
  it('reads the live version and its files and prints the plan, and makes no writing call', async () => {
    const fake = site();
    await run(fake, { dir: makeDir({ 'index.html': 'v1', 'gone.js': 'g' }), rules: CAPE_RULES });
    fake.calls.length = 0;
    const versions = fake.versions.size;
    const dryRun = run(fake, { dir: makeDir({ 'index.html': 'v2', 'new.js': 'n' }), rules: { rewrites: CAPE_RULES.rewrites }, dryRun: true });
    const result = await dryRun;
    expect(fake.writes()).toEqual([]);
    expect(fake.calls.length).toBeGreaterThan(0);
    expect(fake.versions.size).toBe(versions);
    expect(result).toMatchObject({ dryRun: true, released: false, counts: { added: 1, changed: 1, unchanged: 0, removed: 1 } });
    const text = dryRun.lines.join('\n');
    expect(text).toContain('live version sites/games/versions/');
    expect(text).toContain("this deploy's files: 1 new, 1 changed, 0 unchanged");
    expect(text).toContain('/capesorrow/gone.js');
    expect(text).toContain('files of others kept: 4');
    expect(text).toMatch(/- \/capesorrow\/assets\/\*\*: Cache-Control/);
    expect(text).toContain('dry run: nothing was written');
  });

  it('lists at most 20 of the files it would remove', async () => {
    const fake = site();
    const many = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`f${String(i).padStart(2, '0')}.js`, `c${i}`]));
    await run(fake, { dir: makeDir({ 'index.html': 'v1', ...many }) });
    const dryRun = run(fake, { dir: makeDir({ 'index.html': 'v1' }), dryRun: true });
    await dryRun;
    expect(dryRun.lines.join('\n')).toContain('removed from the site: 25');
    expect(dryRun.lines.join('\n')).toContain('... and 5 more');
  });
});

describe('a deploy that fails', () => {
  const noReleaseOf = (fake, version) => expect(fake.releases.some((r) => r.version === version)).toBe(false);

  it('stops at the guard, deletes the new version and releases nothing, when the clone loses another game\'s file', async () => {
    const fake = site();
    fake.cloneDrops = (path) => path === '/dayhike/assets/a.js';
    const releases = fake.releases.length;
    const error = await run(fake, { dir: makeDir({ 'index.html': 'v1' }) }).catch((e) => e);
    expect(error.message).toContain('nothing was released');
    expect(error.message).toContain('/dayhike/assets/a.js of another game is missing from the new version');
    expect(fake.releases).toHaveLength(releases);
    expect(fake.deleted).toHaveLength(1);
    expect(fake.liveFiles()).toEqual(hashes(SITE_FILES));
  });

  it('stops at the guard when the clone keeps a file of this deploy\'s that is no longer planned', async () => {
    const fake = new FakeHosting({ token: TOKEN });
    fake.seed({ ...SITE_FILES, '/capesorrow/index.html': 'old', '/capesorrow/stale.js': 'stale' }, LIVE_CONFIG);
    // A clone that ignores its exclusions: the version would then hold the old files of this game.
    const clone = fake.fetch;
    fake.fetch = async (url, init) => {
      if (init?.method === 'POST' && String(url).endsWith('versions:clone')) {
        const body = JSON.parse(init.body);
        body.exclude = { regexes: [] };
        return clone(url, { ...init, body: JSON.stringify(body) });
      }
      return clone(url, init);
    };
    const error = await run(fake, { dir: makeDir({ 'index.html': 'new' }), fetch: fake.fetch }).catch((e) => e);
    expect(error.message).toContain('/capesorrow/stale.js is in the new version, and this deploy does not serve it');
    expect(fake.deleted).toHaveLength(1);
  });

  it('releases nothing and deletes the new version when live moves between the clone and the release', async () => {
    const fake = site();
    let moved = false;
    fake.onCall = (call) => {
      if (call.method === 'PATCH' && call.query.update_mask === 'status' && !moved) {
        moved = true;
        fake.simulateOtherDeploy();
      }
    };
    const before = fake.releases.length;
    const error = await run(fake, { dir: makeDir({ 'index.html': 'v1' }) }).catch((e) => e);
    expect(error.message).toBe('the site changed while this deploy ran; run it again');
    expect(fake.releases).toHaveLength(before + 1); // the other deploy's, and none of ours
    expect(fake.deleted).toHaveLength(1);
    noReleaseOf(fake, fake.deleted[0]);
    expect(fake.liveFiles()['/other/new.html']).toBe(hashOf('new'));
  });

  it('releases nothing and deletes the new version when an upload fails three times', async () => {
    const fake = site();
    const bad = hashOf('bad content');
    fake.failUpload = (hash) => (hash === bad ? 503 : undefined);
    const run1 = run(fake, { dir: makeDir({ 'index.html': 'v1', 'bad.js': 'bad content' }) });
    const error = await run1.catch((e) => e);
    expect(error.message).toMatch(/POST \/upload\/sites\/games\/versions\/\d+\/files\/[0-9a-f]{64}: HTTP 503/);
    expect(fake.uploadAttempts.get(bad)).toBe(3);
    expect(run1.sleeps.length).toBeGreaterThanOrEqual(2);
    expect(fake.releases).toHaveLength(1);
    expect(fake.deleted).toHaveLength(1);
    expect(fake.liveFiles()).toEqual(hashes(SITE_FILES));
  });

  it('goes on when an upload fails twice (a network error, then a 5xx) and then succeeds', async () => {
    const fake = site();
    const flaky = hashOf('flaky');
    fake.failUpload = (hash, attempt) => (hash === flaky ? (attempt === 1 ? 'network' : attempt === 2 ? 502 : undefined) : undefined);
    const result = await run(fake, { dir: makeDir({ 'index.html': 'v1', 'flaky.js': 'flaky' }) });
    expect(result.released).toBe(true);
    expect(fake.uploadAttempts.get(flaky)).toBe(3);
    expect(fake.liveFiles()['/capesorrow/flaky.js']).toBe(flaky);
  });

  it('refuses a site with no live release before any write', async () => {
    const fake = new FakeHosting({ token: TOKEN });
    const error = await run(fake, { dir: makeDir({ 'index.html': 'v1' }) }).catch((e) => e);
    expect(error.message).toMatch(/has never been deployed/);
    expect(fake.writes()).toEqual([]);
    expect(fake.versions.size).toBe(0);
  });

  it('refuses a folder with no index.html before any write', async () => {
    const fake = site();
    const error = await run(fake, { dir: makeDir({ 'main.html': 'x' }) }).catch((e) => e);
    expect(error.message).toMatch(/no index\.html/);
    expect(fake.writes()).toEqual([]);
  });

  it('says it when the new version could not be deleted either, and keeps the first error', async () => {
    const fake = site();
    fake.cloneDrops = (path) => path === '/index.html';
    const fetch = async (url, init) => {
      if (init?.method === 'DELETE') throw new TypeError('socket closed');
      return fake.fetch(url, init);
    };
    const error = await run(fake, { dir: makeDir({ 'index.html': 'v1' }), fetch }).catch((e) => e);
    expect(error.message).toContain('/index.html of another game is missing');
    expect(error.message).toMatch(/new version sites\/games\/versions\/\d+ could not be deleted either: DELETE .*network error/);
  });

  it('never has the token in a message', async () => {
    const fake = site();
    const error = await run(fake, { dir: makeDir({ 'index.html': 'v1' }), token: 'wrong-token' }).catch((e) => e);
    expect(error.message).toContain('HTTP 401');
    expect(error.message).not.toContain('wrong-token');
    expect(error.message).not.toContain(TOKEN);
  });

  it('deletes the new version when any call after the clone fails, here the config\'s', async () => {
    const fake = site();
    fake.onCall = (call) => {
      if (call.method === 'PATCH' && call.query.update_mask === 'config') throw new Error('connection lost');
    };
    const error = await run(fake, { dir: makeDir({ 'index.html': 'v1' }) }).catch((e) => e);
    expect(error.message).toMatch(/PATCH .*update_mask=config: network error: connection lost/);
    expect(fake.deleted).toHaveLength(1);
    expect(fake.releases).toHaveLength(1);
  });
});

describe('many files', () => {
  it('sends populateFiles in batches of at most 1000 and uploads at most 8 at a time', async () => {
    const fake = site();
    const files = { 'index.html': 'v1' };
    for (let i = 0; i < 1100; i++) files[`f/${i}.txt`] = `content ${i}`;
    let inFlight = 0;
    let most = 0;
    const fetch = async (url, init) => {
      const upload = String(url).includes('/upload/');
      if (upload) {
        most = Math.max(most, ++inFlight);
        for (let i = 0; i < 5; i++) await Promise.resolve();
      }
      try {
        return await fake.fetch(url, init);
      } finally {
        if (upload) inFlight--;
      }
    };
    const result = await run(fake, { dir: makeDir(files), fetch });
    const populates = fake.calls.filter((c) => c.path.endsWith(':populateFiles'));
    expect(populates.map((c) => Object.keys(c.body.files).length)).toEqual([1000, 101]);
    expect(most).toBe(8);
    expect(fake.uploads).toHaveLength(1101);
    expect(result.counts.added).toBe(1101);
    expect(Object.keys(fake.liveFiles())).toHaveLength(Object.keys(SITE_FILES).length + 1101);
  });

  it('reads a file list that comes in pages', async () => {
    const fake = site();
    fake.pageSize = 2;
    const result = await run(fake, { dir: makeDir({ 'index.html': 'v1' }) });
    expect(result.counts.kept).toBe(4);
    expect(fake.calls.filter((c) => c.method === 'GET' && c.path.endsWith('/files')).length).toBeGreaterThan(2);
  });

  it('uploads a file that two paths share once', async () => {
    const fake = site();
    await run(fake, { dir: makeDir({ 'index.html': 'same', 'copy.html': 'same' }) });
    expect(fake.uploads).toEqual([hashOf('same')]);
  });
});

describe('with a rules file', () => {
  it('ships the rules of a file in firebase.json\'s syntax', async () => {
    const file = join(makeDir({ 'rules.json': JSON.stringify({ redirects: [{ source: '/capesorrow/old', destination: '/capesorrow/', type: 301 }] }) }), 'rules.json');
    const rules = loadRules(file, { path: '/capesorrow', root: false });
    const fake = site();
    await run(fake, { dir: makeDir({ 'index.html': 'v1' }), rules });
    expect(fake.liveVersion().config.redirects.at(-2)).toEqual({ glob: '/capesorrow/old', statusCode: 301, location: '/capesorrow/' });
  });
});
