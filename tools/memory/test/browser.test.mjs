import { describe, expect, it } from 'vitest';
import { chromeCandidates, chromeFlags, findChrome } from '../lib/chrome.mjs';
import { parsePs, processKind } from '../lib/collect.mjs';
import { defaultLabel } from '../check.mjs';

describe('findChrome', () => {
  it('takes the named browser, and fails if it is not there', () => {
    expect(findChrome({ chrome: '/x/chrome', env: {}, exists: (p) => p === '/x/chrome' })).toBe('/x/chrome');
    expect(findChrome({ env: { CHROME: '/y/chrome' }, exists: () => true })).toBe('/y/chrome');
    expect(() => findChrome({ chrome: '/x/chrome', env: {}, exists: () => false })).toThrow('Chrome not found at /x/chrome (from --chrome)');
    expect(() => findChrome({ env: { CHROME: '/y' }, exists: () => false })).toThrow('(from CHROME)');
  });
  it('lets --chrome win over CHROME', () => {
    expect(findChrome({ chrome: '/a', env: { CHROME: '/b' }, exists: () => true })).toBe('/a');
  });
  it('looks in the usual places of the platform, first that exists', () => {
    const second = chromeCandidates('linux')[1];
    expect(findChrome({ env: {}, platform: 'linux', exists: (p) => p === second })).toBe(second);
    expect(chromeCandidates('darwin')[0]).toContain('Google Chrome.app');
    expect(chromeCandidates('win32', { PROGRAMFILES: 'C:\\P' })).toHaveLength(1);
  });
  it('says what it looked in and how to name another when it finds none', () => {
    expect(() => findChrome({ env: {}, platform: 'linux', exists: () => false })).toThrow(/no Chrome found; looked in \/usr\/bin\/google-chrome.*CHROME.*--chrome/);
  });
});

describe('chromeFlags', () => {
  const flags = chromeFlags({ profileDir: '/tmp/p', width: 800, height: 600, platform: 'darwin' });
  it('uses a profile of its own, a port the system picks and the page size', () => {
    expect(flags).toContain('--user-data-dir=/tmp/p');
    expect(flags).toContain('--remote-debugging-port=0');
    expect(flags).toContain('--window-size=800,600');
    expect(flags).toContain('--enable-precise-memory-info');
  });
  it('picks the Mac graphics path only on a Mac', () => {
    expect(flags).toContain('--use-angle=metal');
    expect(chromeFlags({ profileDir: '/p', width: 1, height: 1, platform: 'linux' })).not.toContain('--use-angle=metal');
  });
});

describe('the browser processes', () => {
  const ps = [
    '  11  1000 /Chrome --user-data-dir=/tmp/p --remote-debugging-port=0',
    '  12  2048 /Chrome Helper --type=renderer --user-data-dir=/tmp/p',
    '  13  3072 /Chrome Helper --type=utility --utility-sub-type=network.mojom.NetworkService --user-data-dir=/tmp/p',
    '  14  9999 /other/app --user-data-dir=/tmp/elsewhere',
  ].join('\n');
  it('picks the lines of this profile and reads pid, size and command', () => {
    expect(parsePs(ps, '/tmp/p').map((p) => [p.pid, p.rssKb])).toEqual([[11, 1000], [12, 2048], [13, 3072]]);
  });
  it('names a process by its kind', () => {
    expect(processKind('/Chrome --user-data-dir=/p')).toBe('browser');
    expect(processKind('x --type=gpu-process')).toBe('gpu-process');
    expect(processKind('x --type=utility --utility-sub-type=network.mojom.NetworkService')).toBe('utility:network.mojom.NetworkService');
  });
});

describe('defaultLabel', () => {
  it('is the host and the time', () => {
    expect(defaultLabel('https://games.example.com/a/b?x=1', new Date('2026-11-27T10:15:00.123Z'))).toBe('games.example.com-20261127T101500');
  });
});
