import { describe, expect, it } from 'vitest';
import { USAGE, parseArgs } from '../lib/args.mjs';

const base = ['--project', 'my-proj-123', '--site', 'games-csarko', '--path', '/capesorrow', '--dir', 'dist'];

describe('parseArgs', () => {
  it('takes the four required options and leaves the rest unset', () => {
    expect(parseArgs(base)).toEqual({
      project: 'my-proj-123',
      site: 'games-csarko',
      path: '/capesorrow',
      dir: 'dist',
      rules: undefined,
      rootDir: undefined,
      channel: undefined,
      expires: undefined,
      message: undefined,
      dryRun: false,
    });
  });
  it('takes the optional ones, with 7 days for a channel', () => {
    const o = parseArgs([...base, '--rules', 'site.json', '--root-dir', 'site', '--channel', 'try-1', '--message', 'a b', '--dry-run']);
    expect(o).toMatchObject({ rules: 'site.json', rootDir: 'site', channel: 'try-1', expires: 7, message: 'a b', dryRun: true });
    expect(parseArgs([...base, '--channel', 'x', '--expires', '30']).expires).toBe(30);
  });
  it('refuses a missing required option, naming it', () => {
    for (const name of ['project', 'site', 'path', 'dir']) {
      const argv = base.filter((_, i) => base[i] !== `--${name}` && base[i - 1] !== `--${name}`);
      expect(() => parseArgs(argv)).toThrow(new RegExp(`--${name} is required`));
    }
    expect(() => parseArgs([])).toThrow(/is required/);
  });
  it('refuses a path that is not one slash and one lowercase segment', () => {
    for (const path of ['capesorrow', '/', '/a/b', '/capesorrow/', '//a', '/Cape', '/a_b', '/-a', '/a b', '/../x', '/a.b', '*', '/a?b']) {
      expect(() => parseArgs(['--project', 'my-proj-123', '--site', 'g', '--path', path, '--dir', 'd']), path).toThrow(/--path/);
    }
    expect(parseArgs(['--project', 'my-proj-123', '--site', 'g', '--path', '/a-1', '--dir', 'd']).path).toBe('/a-1');
  });
  it('refuses a project or site that could not be an id', () => {
    expect(() => parseArgs(['--project', 'a/b', '--site', 'g', '--path', '/a', '--dir', 'd'])).toThrow(/--project/);
    expect(() => parseArgs(['--project', 'my-proj-123', '--site', 'a/b', '--path', '/a', '--dir', 'd'])).toThrow(/--site/);
    expect(() => parseArgs(['--project', 'my-proj-123', '--site', 'G', '--path', '/a', '--dir', 'd'])).toThrow(/--site/);
  });
  it('refuses a channel name outside the pattern', () => {
    for (const channel of ['-a', 'a-', 'A', 'a_b', 'a/b', 'x'.repeat(37), 'live/x']) {
      expect(() => parseArgs([...base, '--channel', channel]), channel).toThrow(/--channel/);
    }
    expect(parseArgs([...base, '--channel', 'x'.repeat(36)]).channel).toHaveLength(36);
    expect(parseArgs([...base, '--channel', 'a']).channel).toBe('a');
  });
  it('refuses --expires without a channel, and one that is not 1 to 30 whole days', () => {
    expect(() => parseArgs([...base, '--expires', '3'])).toThrow(/--expires needs --channel/);
    for (const days of ['0', '31', '1.5', 'x', '-1', '']) {
      expect(() => parseArgs([...base, '--channel', 'c', '--expires', days]), days).toThrow(/--expires|needs a value/);
    }
  });
  it('refuses an unknown option, a missing value, a value that is the next option, and an option given twice', () => {
    expect(() => parseArgs([...base, '--force'])).toThrow(/unknown option --force/);
    expect(() => parseArgs([...base, 'stray'])).toThrow(/unknown option stray/);
    expect(() => parseArgs([...base, '--rules'])).toThrow(/--rules needs a value/);
    expect(() => parseArgs([...base, '--rules', '--dry-run'])).toThrow(/--rules needs a value/);
    expect(() => parseArgs([...base, '--dir', 'again'])).toThrow(/--dir is given twice/);
  });
  it('has a usage text that names every option', () => {
    for (const option of ['--project', '--site', '--path', '--dir', '--rules', '--root-dir', '--channel', '--expires', '--message', '--dry-run']) {
      expect(USAGE).toContain(option);
    }
  });
});
