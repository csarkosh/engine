import { describe, expect, it } from 'vitest';
import { isFileOfPath, isFileOfRoot, isRuleOfPath, isRuleOfSomePath, ownsFile, ownsRule, patternOf } from '../lib/owns.mjs';

const game = { path: '/capesorrow', root: false };
const owner = { path: '/capesorrow', root: true };

describe('files', () => {
  it('are of a path when they begin with the path and a slash', () => {
    expect(isFileOfPath('/dayhike', '/dayhike/index.html')).toBe(true);
    expect(isFileOfPath('/dayhike', '/dayhike/assets/a/b.js')).toBe(true);
  });
  it('are not of a path that only begins the same: /dayhikes/x, /dayhike, /dayhike.html', () => {
    expect(isFileOfPath('/dayhike', '/dayhikes/x')).toBe(false);
    expect(isFileOfPath('/dayhike', '/dayhike')).toBe(false);
    expect(isFileOfPath('/dayhike', '/dayhike.html')).toBe(false);
    expect(isFileOfPath('/dayhike', '/other/dayhike/x')).toBe(false);
  });
  it('are of the root with exactly one segment', () => {
    expect(isFileOfRoot('/index.html')).toBe(true);
    expect(isFileOfRoot('/favicon.ico')).toBe(true);
    expect(isFileOfRoot('/dayhike/index.html')).toBe(false);
    expect(isFileOfRoot('/')).toBe(false);
  });
  it('are owned by a game of its path only, and by the root deploy of its path and the top level', () => {
    expect(ownsFile(game, '/capesorrow/a.js')).toBe(true);
    expect(ownsFile(game, '/index.html')).toBe(false);
    expect(ownsFile(game, '/dayhike/a.js')).toBe(false);
    expect(ownsFile(game, '/capesorrows/a.js')).toBe(false);
    expect(ownsFile(owner, '/capesorrow/a.js')).toBe(true);
    expect(ownsFile(owner, '/index.html')).toBe(true);
    expect(ownsFile(owner, '/favicon.ico')).toBe(true);
    expect(ownsFile(owner, '/dayhike/a.js')).toBe(false);
  });
});

describe('rules', () => {
  it('are of a path when the glob is the path or begins with it and a slash', () => {
    for (const glob of ['/dayhike', '/dayhike/admin', '/dayhike/admin/**', '/dayhike/**']) {
      expect(isRuleOfPath('/dayhike', { glob })).toBe(true);
    }
  });
  it('are not of a path that only begins the same, or that has it later', () => {
    for (const glob of ['/dayhikes/x', '/dayhike-two/**', '/dayhikes', '/x/dayhike/y', '**/dayhike/**']) {
      expect(isRuleOfPath('/dayhike', { glob })).toBe(false);
    }
  });
  it('are of some path when they begin with a literal first segment', () => {
    for (const glob of ['/dayhike/admin', '/dayhike/**', '/dayhike', '/dayhikes/x', '/a.b_c-d/x', '/favicon.ico']) {
      expect(isRuleOfSomePath({ glob })).toBe(true);
    }
  });
  it('are of the root when they do not', () => {
    for (const glob of ['/', '**', '/*.html', '/**', '/{a,b}/x', '*', '']) {
      expect(isRuleOfSomePath({ glob })).toBe(false);
    }
  });
  it('read a regex without one leading ^ and one trailing $', () => {
    expect(patternOf({ regex: '^/dayhike/.*$' })).toBe('/dayhike/.*');
    expect(patternOf({ regex: '/dayhike/.*' })).toBe('/dayhike/.*');
    expect(patternOf({ regex: '^^/x' })).toBe('^/x');
    expect(patternOf({ glob: '/dayhike/**' })).toBe('/dayhike/**');
  });
  it('are judged by their regex text as by a glob: of a path, of some path, of the root', () => {
    expect(isRuleOfPath('/dayhike', { regex: '^/dayhike/admin(/.*)?$' })).toBe(true);
    expect(isRuleOfPath('/dayhike', { regex: '/dayhike/.*' })).toBe(true);
    expect(isRuleOfPath('/dayhike', { regex: '^/dayhike$' })).toBe(true);
    expect(isRuleOfPath('/dayhike', { regex: '^/dayhikes/.*$' })).toBe(false);
    expect(isRuleOfSomePath({ regex: '^/dayhikes/.*$' })).toBe(true);
    expect(isRuleOfSomePath({ regex: '^/dayhike$' })).toBe(true);
    expect(isRuleOfSomePath({ regex: '^.*$' })).toBe(false);
    expect(isRuleOfSomePath({ regex: '^/(a|b)/x$' })).toBe(false);
    expect(isRuleOfSomePath({ regex: '^/$' })).toBe(false);
  });
  it('are owned by a game when of its path, and by the root deploy when of its path or of the root', () => {
    expect(ownsRule(game, { glob: '/capesorrow/**' })).toBe(true);
    expect(ownsRule(game, { regex: '^/capesorrow/old/.*$' })).toBe(true);
    expect(ownsRule(game, { glob: '**' })).toBe(false);
    expect(ownsRule(game, { glob: '/' })).toBe(false);
    expect(ownsRule(game, { glob: '/dayhike/**' })).toBe(false);
    expect(ownsRule(owner, { glob: '**' })).toBe(true);
    expect(ownsRule(owner, { glob: '/' })).toBe(true);
    expect(ownsRule(owner, { glob: '/*.html' })).toBe(true);
    expect(ownsRule(owner, { regex: '^.*\\.html$' })).toBe(true);
    expect(ownsRule(owner, { glob: '/capesorrow/**' })).toBe(true);
    expect(ownsRule(owner, { glob: '/dayhike/**' })).toBe(false);
    expect(ownsRule(owner, { glob: '/capesorrows/**' })).toBe(false);
  });
});
