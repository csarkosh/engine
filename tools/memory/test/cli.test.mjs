import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inventory } from './fixture.mjs';

const tools = join(dirname(fileURLToPath(import.meta.url)), '..');
let dir;
const file = (name, value) => {
  const path = join(dir, name);
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
  return path;
};
const node = (script, ...args) => spawnSync(process.execPath, [join(tools, script), ...args], { encoding: 'utf8' });

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'memory-cli-test-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('group.mjs', () => {
  it('prints a table of an inventory file', () => {
    const r = node('group.mjs', file('a.json', inventory));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('GPU buffers 6.0 MB, textures 11.0 MB');
    expect(r.stdout).toContain('src/town/parts.ts buildTown');
  });
  it('takes a game rules file and prints JSON on request', () => {
    const r = node('group.mjs', file('a.json', inventory), '--rules', file('r.json', [{ name: 'town', stack: 'town/' }]), '--json');
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).groups.find((g) => g.name === 'town').count).toBe(4);
  });
  it('says what is wrong, with the usage, and exits 2', () => {
    const r = node('group.mjs', file('bad.json', '{'));
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/cannot read .*bad\.json/);
    expect(node('group.mjs', '--by', 'x', 'a').stderr).toContain('--by must be one of');
    expect(node('group.mjs', file('r2.json', '[]'), '--rules', file('r3.json', '[{"label":"a"}]')).stderr).toContain('rule 1: needs a name');
  });
});

describe('diff.mjs', () => {
  it('finds nothing between a run and itself', () => {
    const a = file('a.json', inventory);
    const r = node('diff.mjs', a, a);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('no group changed');
  });
  it('shows a change', () => {
    const after = structuredClone(inventory);
    after.gpu.entries[0].bytes -= 1048576;
    const r = node('diff.mjs', file('a.json', inventory), file('b.json', after));
    expect(r.stdout).toContain('GPU total 17.0 -> 16.0 MB (-1.0)');
    expect(JSON.parse(node('diff.mjs', file('a.json', inventory), file('b.json', after), '--json').stdout).delta.bytes).toBe(-1048576);
  });
  it('needs two files', () => {
    expect(node('diff.mjs', 'a.json').status).toBe(2);
  });
});

describe('check.mjs', () => {
  it('prints its usage for --help and refuses a bad command line without starting a browser', () => {
    expect(node('check.mjs', '--help').stdout).toContain('--url <address>');
    const r = node('check.mjs', '--url', 'nope');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--url is not an address');
  });
  it('says so when it finds no Chrome', () => {
    const r = node('check.mjs', '--url', 'http://127.0.0.1:9/', '--chrome', join(dir, 'no-such-chrome'));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Chrome not found at');
  });
});
