import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertOwned, convertRules, loadRules } from '../lib/rules.mjs';

const game = { path: '/capesorrow', root: false };
const owner = { path: '/capesorrow', root: true };

describe('convertRules', () => {
  it('turns firebase.json\'s rules into the API\'s: source to glob, destination to location or path, type to statusCode, headers to a map', () => {
    const rules = convertRules({
      redirects: [
        { source: '/capesorrow/old', destination: '/capesorrow/new', type: 302 },
        { regex: '^/capesorrow/a/(.*)$', destination: '/capesorrow/b/$1' },
      ],
      rewrites: [{ source: '/capesorrow/**', destination: '/capesorrow/index.html' }, { regex: '^/capesorrow/x$', destination: '/capesorrow/y.html' }],
      headers: [{ source: '/capesorrow/assets/**', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }, { key: 'X-A', value: 'b' }] }],
    });
    expect(rules).toEqual({
      redirects: [
        { glob: '/capesorrow/old', statusCode: 302, location: '/capesorrow/new' },
        { regex: '^/capesorrow/a/(.*)$', statusCode: 301, location: '/capesorrow/b/$1' },
      ],
      rewrites: [{ glob: '/capesorrow/**', path: '/capesorrow/index.html' }, { regex: '^/capesorrow/x$', path: '/capesorrow/y.html' }],
      headers: [{ glob: '/capesorrow/assets/**', headers: { 'Cache-Control': 'public, max-age=31536000, immutable', 'X-A': 'b' } }],
    });
  });
  it('takes an empty file as no rules', () => {
    expect(convertRules({})).toEqual({ redirects: [], rewrites: [], headers: [] });
  });
  it('refuses any other top-level key, naming it', () => {
    expect(() => convertRules({ cleanUrls: true })).toThrow(/"cleanUrls"/);
    expect(() => convertRules({ i18n: {} })).toThrow(/"i18n"/);
    expect(() => convertRules({ redirects: [], public: 'dist' })).toThrow(/"public"/);
  });
  it('refuses what is not an object or a list', () => {
    expect(() => convertRules([])).toThrow(/one JSON object/);
    expect(() => convertRules(null)).toThrow(/one JSON object/);
    expect(() => convertRules({ redirects: {} })).toThrow(/"redirects" must be a list/);
    expect(() => convertRules({ rewrites: ['x'] })).toThrow(/rewrites\[0\] is not an object/);
  });
  it('refuses a rewrite to anything but a destination path', () => {
    expect(() => convertRules({ rewrites: [{ source: '/capesorrow/api', function: 'api' }] })).toThrow(/"function"/);
    expect(() => convertRules({ rewrites: [{ source: '/capesorrow/api', run: { serviceId: 'x' } }] })).toThrow(/"run"/);
    expect(() => convertRules({ rewrites: [{ source: '/capesorrow/api', destination: 'index.html' }] })).toThrow(/path beginning with "\/"/);
    expect(() => convertRules({ rewrites: [{ source: '/capesorrow/api' }] })).toThrow(/destination/);
  });
  it('refuses a rule with both or neither of source and regex, or an empty one', () => {
    expect(() => convertRules({ redirects: [{ destination: '/x' }] })).toThrow(/exactly one of "source" and "regex"/);
    expect(() => convertRules({ redirects: [{ source: '/a', regex: '/a', destination: '/x' }] })).toThrow(/exactly one/);
    expect(() => convertRules({ redirects: [{ source: '', destination: '/x' }] })).toThrow(/non-empty/);
  });
  it('refuses a redirect without a destination or with a type that is not 3xx, and a rule key it does not know', () => {
    expect(() => convertRules({ redirects: [{ source: '/a' }] })).toThrow(/destination/);
    expect(() => convertRules({ redirects: [{ source: '/a', destination: '/b', type: 200 }] })).toThrow(/3xx/);
    expect(() => convertRules({ redirects: [{ source: '/a', destination: '/b', type: '301' }] })).toThrow(/3xx/);
    expect(() => convertRules({ redirects: [{ source: '/a', destination: '/b', extra: 1 }] })).toThrow(/"extra"/);
  });
  it('refuses headers that are empty, malformed or set twice', () => {
    expect(() => convertRules({ headers: [{ source: '/a', headers: [] }] })).toThrow(/non-empty/);
    expect(() => convertRules({ headers: [{ source: '/a' }] })).toThrow(/non-empty/);
    expect(() => convertRules({ headers: [{ source: '/a', headers: [{ key: 'X' }] }] })).toThrow(/key.*value/);
    expect(() => convertRules({ headers: [{ source: '/a', headers: [{ key: 'X', value: 'a' }, { key: 'x', value: 'b' }] }] })).toThrow(/twice/);
  });
});

describe('assertOwned', () => {
  const rules = (...globs) => ({ redirects: globs.map((glob) => ({ glob, statusCode: 301, location: '/x' })) });
  it('passes the rules of the path, and of the root for the root\'s owner', () => {
    expect(() => assertOwned(game, rules('/capesorrow/a', '/capesorrow/**'))).not.toThrow();
    expect(() => assertOwned(owner, rules('/capesorrow/a', '**', '/', '/*.html'))).not.toThrow();
  });
  it('refuses a game\'s root rule, naming it and saying what to pass', () => {
    expect(() => assertOwned(game, rules('/capesorrow/a', '**'))).toThrow(/redirects rule \*\*.*root.*--root-dir/);
    expect(() => assertOwned(game, rules('/'))).toThrow(/root/);
  });
  it('refuses another game\'s path, and a near miss of its own', () => {
    expect(() => assertOwned(game, rules('/dayhike/**'))).toThrow(/rule \/dayhike\/\*\* is not of \/capesorrow/);
    expect(() => assertOwned(owner, rules('/dayhike/**'))).toThrow(/not of \/capesorrow/);
    expect(() => assertOwned(game, rules('/capesorrows/x'))).toThrow(/not of \/capesorrow/);
  });
  it('names a regex rule and a rule of any list', () => {
    expect(() => assertOwned(game, { headers: [{ regex: '^/dayhike/.*$', headers: { A: 'b' } }] })).toThrow(/headers rule regex \^\/dayhike\/\.\*\$ is not of/);
    expect(() => assertOwned(game, { rewrites: [{ glob: '**', path: '/index.html' }] })).toThrow(/rewrites rule \*\*/);
  });
});

describe('loadRules', () => {
  const file = (content) => {
    const path = join(mkdtempSync(join(tmpdir(), 'site-rules-')), 'rules.json');
    writeFileSync(path, content);
    return path;
  };
  it('reads, converts and checks a file', () => {
    const rules = loadRules(file(JSON.stringify({ rewrites: [{ source: '/capesorrow/**', destination: '/capesorrow/index.html' }] })), game);
    expect(rules.rewrites).toEqual([{ glob: '/capesorrow/**', path: '/capesorrow/index.html' }]);
  });
  it('refuses a file that is missing or not JSON, and a file with a rule that is not the deploy\'s', () => {
    expect(() => loadRules(join(tmpdir(), 'site-rules-none.json'), game)).toThrow(/cannot read the rules file/);
    expect(() => loadRules(file('{'), game)).toThrow(/cannot read the rules file/);
    expect(() => loadRules(file(JSON.stringify({ rewrites: [{ source: '**', destination: '/index.html' }] })), game)).toThrow(/rewrites rule \*\*/);
  });
});
