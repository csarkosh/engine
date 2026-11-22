import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { makeDir } from './helpers.mjs';

const ENTRY = fileURLToPath(new URL('../deploy.mjs', import.meta.url));
// gcloud is taken off the path, so a run that got as far as asking for a token would fail with that, not with usage.
const run = (...argv) => spawnSync(process.execPath, [ENTRY, ...argv], { encoding: 'utf8', env: { PATH: '' } });
const base = ['--project', 'my-proj-123', '--site', 'games', '--path', '/capesorrow', '--dir', '.'];

describe('the command', () => {
  it('prints the usage and exits 2 when given nothing, without asking for a token', () => {
    const result = run();
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--project is required');
    expect(result.stderr).toContain('--root-dir');
    expect(result.stdout).toBe('');
  });
  it('exits 2 for an option it does not know and for a path that is not one segment', () => {
    expect(run(...base, '--force').status).toBe(2);
    const bad = run('--project', 'my-proj-123', '--site', 'games', '--path', '/a/b', '--dir', '.');
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('--path');
  });
  it('exits 2 for a rules file with a rule the deploy does not own, before asking for a token', () => {
    const dir = makeDir({ 'rules.json': JSON.stringify({ rewrites: [{ source: '**', destination: '/index.html' }] }) });
    const result = run(...base, '--rules', join(dir, 'rules.json'));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--root-dir');
    expect(result.stderr).not.toContain('gcloud');
  });
  it('exits 1, saying so, when gcloud gives no token', () => {
    const dir = makeDir({ 'index.html': 'a' });
    const result = run('--project', 'my-proj-123', '--site', 'games', '--path', '/capesorrow', '--dir', dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('could not get an access token from gcloud');
  });
});
