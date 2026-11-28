import { describe, expect, it } from 'vitest';
import { diffInventories, groupInventory } from '../lib/inventory.mjs';
import { formatDiff, formatGroups, formatRun } from '../lib/report.mjs';
import { mb, renderTable, signedMb } from '../lib/table.mjs';
import { inventory } from './fixture.mjs';

describe('figures', () => {
  it('gives megabytes with a decimal, and kilobytes for the very small', () => {
    expect(mb(1048576 * 12.5)).toBe('12.5');
    expect(mb(0)).toBe('0.0');
    expect(mb(2048)).toBe('2 KB');
    expect(mb(-40)).toBe('-40 B');
  });
  it('signs a change', () => {
    expect(signedMb(1048576)).toBe('+1.0');
    expect(signedMb(-1048576 * 3)).toBe('-3.0');
    expect(signedMb(0)).toBe('0.0');
  });
});

describe('renderTable', () => {
  it('aligns numbers right and names left, and cuts a name that is too long', () => {
    const text = renderTable([{ title: 'MB', align: 'right' }, { title: 'name', align: 'left' }], [['1.0', 'a'], ['12.5', 'b'.repeat(10)]], { width: 6 });
    expect(text).toBe(['  MB  name', ' 1.0  a', '12.5  bbbbb…'].join('\n'));
  });
});

describe('formatGroups', () => {
  it('prints the totals and the largest groups, then the sum of the rest', () => {
    const text = formatGroups(groupInventory(inventory), 2);
    expect(text.split('\n')[0]).toBe('GPU buffers 6.0 MB, textures 11.0 MB, 11 objects, 5 groups');
    expect(text).toContain('texture @ src/render/post.ts setup');
    expect(text).toContain('(3 smaller groups)');
    expect(text).not.toContain('loadModel');
  });
});

describe('formatDiff', () => {
  const after = structuredClone(inventory);
  after.gpu.entries[0].bytes -= 1048576;
  const d = diffInventories(inventory, after);
  it('prints the totals, the browser sums and each changed group', () => {
    const text = formatDiff(d);
    expect(text).toContain('GPU total 17.0 -> 16.0 MB (-1.0): buffers -1.0, textures 0.0, objects 0');
    expect(text).toContain('browser (MB): renderer 400 -> 400, gpu process 600 -> 600, all 1090 -> 1090, page heap 80 -> 80');
    expect(text).toMatch(/-1\.0\s+4\.0\s+3\.0\s+4 -> 4\s+buffer @ src\/town\/parts\.ts buildTown/);
  });
  it('says so when nothing changed, or nothing changed by enough', () => {
    expect(formatDiff(diffInventories(inventory, inventory))).toContain('no group changed');
    expect(formatDiff(d, { minKb: 2048 })).toContain('no group changed by 2048 KB or more');
  });
});

describe('formatRun', () => {
  const run = {
    ...inventory,
    url: 'https://x.test/',
    page: { title: 'A game', bodyClass: 'world-ready', htmlData: { tier: 'medium' }, bodyData: {}, probe: 3 },
    browser: 'Chrome/150.0',
    viewport: { width: 1280, height: 720, dpr: 1 },
    waitSeconds: 90,
    problems: [],
  };
  it('puts what the page said about itself first, then the processes and heaps and the groups', () => {
    const text = formatRun(run, 'GROUPS');
    expect(text).toContain('fixture: https://x.test/');
    expect(text).toContain('page reports: title "A game", body class "world-ready", tier=medium, probe 3');
    expect(text).toMatch(/gpu-process\s+700\s+600/);
    expect(text).toMatch(/page\s+80\s+100/);
    expect(text.trimEnd().endsWith('GROUPS')).toBe(true);
  });
  it('warns of a texture size that is a guess, and of page errors', () => {
    const text = formatRun({ ...run, gpu: { ...run.gpu, unknownFormats: ['odd'] }, problems: ['boom'] }, 'G');
    expect(text).toContain('a guess (4 bytes a texel): odd');
    expect(text).toContain('page errors: boom');
  });
});
