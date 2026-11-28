import { describe, expect, it } from 'vitest';
import { CHECK_USAGE, parseCheckArgs, parseDiffArgs, parseGroupArgs } from '../lib/args.mjs';

describe('parseCheckArgs', () => {
  it('takes the address and leaves the rest at its defaults', () => {
    expect(parseCheckArgs(['--url', 'https://games.example/a/'])).toEqual({
      help: false,
      url: 'https://games.example/a/',
      label: undefined,
      out: 'tools/memory/runs',
      wait: 90,
      width: 1280,
      height: 720,
      dpr: 1,
      heap: false,
      probe: undefined,
      chrome: undefined,
    });
  });
  it('keeps the address exactly as given, query and all', () => {
    const url = 'http://localhost:5173/game/x?cmd=seed%20a&tier=medium';
    expect(parseCheckArgs(['--url', url]).url).toBe(url);
  });
  it('takes every option', () => {
    const o = parseCheckArgs(['--url', 'http://localhost:1/', '--label', 'run-1', '--out', 'o', '--wait', '110', '--width', '1920', '--height', '1080', '--dpr', '2', '--heap', '--probe', 'document.title', '--chrome', '/x/chrome']);
    expect(o).toMatchObject({ label: 'run-1', out: 'o', wait: 110, width: 1920, height: 1080, dpr: 2, heap: true, probe: 'document.title', chrome: '/x/chrome' });
  });
  it('answers --help without asking for the rest', () => {
    expect(parseCheckArgs(['--help'])).toEqual({ help: true });
    expect(CHECK_USAGE).toContain('--url');
  });
  it('refuses a missing, malformed or non-web address', () => {
    expect(() => parseCheckArgs([])).toThrow(/--url is required/);
    expect(() => parseCheckArgs(['--url', 'games'])).toThrow(/not an address/);
    expect(() => parseCheckArgs(['--url', 'file:///a.html'])).toThrow(/http or https/);
  });
  it('refuses numbers out of range and a label that is not a file name', () => {
    const base = ['--url', 'http://a.test/'];
    expect(() => parseCheckArgs([...base, '--wait', '-1'])).toThrow(/--wait/);
    expect(() => parseCheckArgs([...base, '--wait', 'soon'])).toThrow(/--wait/);
    expect(() => parseCheckArgs([...base, '--width', '12.5'])).toThrow(/--width/);
    expect(() => parseCheckArgs([...base, '--dpr', '0'])).toThrow(/--dpr/);
    expect(() => parseCheckArgs([...base, '--label', '../x'])).toThrow(/--label/);
    expect(() => parseCheckArgs([...base, '--label', 'a b'])).toThrow(/--label/);
  });
  it('refuses an unknown option, a missing value, a repeated option and a stray word', () => {
    const base = ['--url', 'http://a.test/'];
    expect(() => parseCheckArgs([...base, '--wat'])).toThrow(/unknown option --wat/);
    expect(() => parseCheckArgs([...base, '--out'])).toThrow(/--out needs a value/);
    expect(() => parseCheckArgs([...base, '--out', '--heap'])).toThrow(/--out needs a value/);
    expect(() => parseCheckArgs([...base, '--wait', '1', '--wait', '2'])).toThrow(/given twice/);
    expect(() => parseCheckArgs([...base, 'extra'])).toThrow(/unexpected extra/);
  });
});

describe('parseGroupArgs', () => {
  it('takes one file and defaults to grouping by maker, 25 groups', () => {
    expect(parseGroupArgs(['a.json'])).toEqual({ help: false, file: 'a.json', by: 'maker', rules: undefined, top: 25, json: false });
  });
  it('takes the options in any order', () => {
    expect(parseGroupArgs(['--by', 'label', 'a.json', '--rules', 'r.json', '--top', '5', '--json'])).toMatchObject({ file: 'a.json', by: 'label', rules: 'r.json', top: 5, json: true });
  });
  it('refuses no file, two files and a mode it does not know', () => {
    expect(() => parseGroupArgs([])).toThrow(/expected 1 inventory file/);
    expect(() => parseGroupArgs(['a', 'b'])).toThrow(/expected 1 inventory file/);
    expect(() => parseGroupArgs(['a', '--by', 'colour'])).toThrow(/--by must be one of maker, label, kind, full/);
    expect(() => parseGroupArgs(['a', '--top', '0'])).toThrow(/--top/);
  });
});

describe('parseDiffArgs', () => {
  it('takes two files, before then after', () => {
    expect(parseDiffArgs(['a.json', 'b.json'])).toEqual({ help: false, before: 'a.json', after: 'b.json', by: 'maker', rules: undefined, top: 25, minKb: 0, json: false });
    expect(parseDiffArgs(['a', 'b', '--min-kb', '64', '--by', 'kind'])).toMatchObject({ minKb: 64, by: 'kind' });
  });
  it('refuses one file or three', () => {
    expect(() => parseDiffArgs(['a'])).toThrow(/expected 2 inventory files/);
    expect(() => parseDiffArgs(['a', 'b', 'c'])).toThrow(/expected 2 inventory files/);
  });
});
