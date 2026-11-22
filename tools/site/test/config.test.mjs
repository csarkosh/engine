import { describe, expect, it } from 'vitest';
import { mergeConfig } from '../lib/config.mjs';

// The live config of a site two games share: Day Hike's rules, and the root's (the catch-alls and the games page).
const LIVE = {
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
};

const game = { path: '/capesorrow', root: false };
const owner = { path: '/capesorrow', root: true };

const CAPE = {
  headers: [{ glob: '/capesorrow/assets/**', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } }],
  redirects: [{ glob: '/capesorrow/old', statusCode: 301, location: '/capesorrow/' }],
  rewrites: [{ glob: '/capesorrow/**', path: '/capesorrow/index.html' }],
};

describe('mergeConfig', () => {
  it('(a) puts a second game\'s rules before the root\'s catch-alls and leaves the first game\'s alone', () => {
    const merged = mergeConfig(LIVE, CAPE, game);
    expect(merged.rewrites).toEqual([
      { glob: '/dayhike/**', path: '/dayhike/index.html' },
      { glob: '/capesorrow/**', path: '/capesorrow/index.html' },
      { glob: '**', path: '/index.html' },
    ]);
    expect(merged.redirects).toEqual([
      LIVE.redirects[1],
      LIVE.redirects[2],
      { glob: '/capesorrow/old', statusCode: 301, location: '/capesorrow/' },
      LIVE.redirects[0],
    ]);
    // A header later in the list overrides an earlier one: the root's first, then each path's.
    expect(merged.headers).toEqual([LIVE.headers[0], LIVE.headers[1], CAPE.headers[0]]);
  });

  it('(b) leaves the other game\'s rules when the root\'s owner deploys, and replaces the root\'s rules', () => {
    const rules = {
      rewrites: [{ glob: '**', path: '/index.html' }, { glob: '/capesorrow/**', path: '/capesorrow/index.html' }],
      redirects: [{ glob: '/', statusCode: 302, location: 'https://csarko.sh/play' }],
      headers: [{ glob: '**', headers: { 'Cache-Control': 'no-store' } }],
    };
    const merged = mergeConfig(LIVE, rules, owner);
    expect(merged.rewrites).toEqual([
      { glob: '/dayhike/**', path: '/dayhike/index.html' },
      { glob: '/capesorrow/**', path: '/capesorrow/index.html' },
      { glob: '**', path: '/index.html' },
    ]);
    expect(merged.redirects).toEqual([LIVE.redirects[1], LIVE.redirects[2], { glob: '/', statusCode: 302, location: 'https://csarko.sh/play' }]);
    expect(merged.headers).toEqual([{ glob: '**', headers: { 'Cache-Control': 'no-store' } }, LIVE.headers[1]]);
  });

  it('(c) gives the same config when the same rules are deployed twice', () => {
    const once = mergeConfig(LIVE, CAPE, game);
    const twice = mergeConfig(once, CAPE, game);
    expect(twice).toEqual(once);
    const rootOnce = mergeConfig(LIVE, { rewrites: [{ glob: '**', path: '/index.html' }] }, owner);
    expect(mergeConfig(rootOnce, { rewrites: [{ glob: '**', path: '/index.html' }] }, owner)).toEqual(rootOnce);
  });

  it('(d) removes from the site a rule that is gone from the file', () => {
    const once = mergeConfig(LIVE, CAPE, game);
    const without = mergeConfig(once, { rewrites: CAPE.rewrites }, game);
    expect(without.redirects).toEqual([LIVE.redirects[1], LIVE.redirects[2], LIVE.redirects[0]]);
    expect(without.headers).toEqual(LIVE.headers);
    expect(without.rewrites).toEqual(once.rewrites);
    // And a game that ships no rules at all takes all of its own away. (The live fixture lists the root's
    // redirect first; the merge puts the rules of paths before the root's, so it comes last.)
    expect(mergeConfig(once, {}, game)).toEqual({ ...LIVE, redirects: [LIVE.redirects[1], LIVE.redirects[2], LIVE.redirects[0]] });
  });

  it('keeps the live order of the kept rules, and this deploy\'s in the file\'s order', () => {
    const rules = { redirects: [{ glob: '/capesorrow/b', statusCode: 301, location: '/x' }, { glob: '/capesorrow/a', statusCode: 301, location: '/y' }] };
    expect(mergeConfig(LIVE, rules, game).redirects.map((r) => r.glob)).toEqual(['/dayhike/admin', '/dayhike/admin/**', '/capesorrow/b', '/capesorrow/a', '/']);
  });

  it('treats a regex rule as it does a glob, in what it drops and where it puts it', () => {
    const live = { rewrites: [{ regex: '^/capesorrow/old/.*$', path: '/capesorrow/index.html' }, { regex: '^.*$', path: '/index.html' }] };
    const merged = mergeConfig(live, { rewrites: [{ regex: '^/capesorrow/new/.*$', path: '/capesorrow/index.html' }] }, game);
    expect(merged.rewrites).toEqual([{ regex: '^/capesorrow/new/.*$', path: '/capesorrow/index.html' }, { regex: '^.*$', path: '/index.html' }]);
  });

  it('carries over every other key unchanged, leaves out a list that comes out empty, and takes no live config', () => {
    const live = { cleanUrls: true, trailingSlashBehavior: 'ADD', i18n: { root: '/l' }, appAssociation: 'AUTO', rewrites: [{ glob: '/capesorrow/**', path: '/capesorrow/index.html' }] };
    const merged = mergeConfig(live, {}, game);
    expect(merged).toEqual({ cleanUrls: true, trailingSlashBehavior: 'ADD', i18n: { root: '/l' }, appAssociation: 'AUTO' });
    expect('rewrites' in merged).toBe(false);
    expect(mergeConfig(undefined, CAPE, game).rewrites).toEqual(CAPE.rewrites);
    expect(mergeConfig({}, {}, game)).toEqual({});
  });

  it('does not change the config it was given', () => {
    const copy = structuredClone(LIVE);
    mergeConfig(LIVE, CAPE, game);
    expect(LIVE).toEqual(copy);
  });
});
