// The text the scripts print: a run's summary, a grouped inventory, a difference.
import { mb, renderTable, signedMb } from './table.mjs';

const L = { align: 'left' };
const R = { align: 'right' };

/** A grouped inventory as a table of the `top` largest groups, with the totals above it. */
export function formatGroups({ totals, groups }, top = 25) {
  const shown = groups.slice(0, top);
  const rest = groups.slice(top).reduce((s, g) => ({ bytes: s.bytes + g.bytes, count: s.count + g.count }), { bytes: 0, count: 0 });
  const rows = shown.map((g) => [mb(g.bytes), String(g.count), g.name]);
  if (groups.length > top) rows.push([mb(rest.bytes), String(rest.count), `(${groups.length - top} smaller groups)`]);
  return [
    `GPU buffers ${mb(totals.bufferBytes)} MB, textures ${mb(totals.textureBytes)} MB, ${totals.count} objects, ${groups.length} groups`,
    renderTable([{ title: 'MB', ...R }, { title: 'objects', ...R }, { title: 'group', ...L }], rows),
  ].join('\n');
}

const sign = (n) => (n > 0 ? `+${n}` : String(n));

/** A difference as a table of the groups that changed most (and not under `minKb`), totals above. */
export function formatDiff(diff, { top = 25, minKb = 0 } = {}) {
  const t = diff.delta;
  const b = diff.browser;
  const lines = [
    `GPU total ${mb(diff.before.bytes)} -> ${mb(diff.after.bytes)} MB (${signedMb(t.bytes)}): buffers ${signedMb(t.bufferBytes)}, textures ${signedMb(t.textureBytes)}, objects ${sign(t.count)}`,
    `browser (MB): renderer ${b.before.renderer} -> ${b.after.renderer}, gpu process ${b.before.gpu} -> ${b.after.gpu}, all ${b.before.all} -> ${b.after.all}, page heap ${b.before.pageHeap ?? '-'} -> ${b.after.pageHeap ?? '-'}`,
  ];
  const kept = diff.groups.filter((g) => Math.abs(g.delta) >= minKb * 1024);
  const rows = kept.slice(0, top).map((g) => [signedMb(g.delta), mb(g.beforeBytes), mb(g.afterBytes), `${g.beforeCount} -> ${g.afterCount}`, g.status === 'changed' ? '' : g.status, g.name]);
  if (kept.length > top) rows.push(['', '', '', '', '', `(${kept.length - top} smaller changes)`]);
  if (rows.length === 0) lines.push('no group changed' + (minKb > 0 ? ` by ${minKb} KB or more` : ''));
  else {
    lines.push(
      renderTable(
        [{ title: 'change MB', ...R }, { title: 'before', ...R }, { title: 'after', ...R }, { title: 'objects', ...R }, { title: '', ...L }, { title: 'group', ...L }],
        rows,
      ),
    );
  }
  return lines.join('\n');
}

/** What a run prints at its end: the page's own report, the processes, the heaps, the GPU's largest groups. */
export function formatRun(inv, groupedText) {
  const lines = [`${inv.label}: ${inv.url}`];
  const p = inv.page ?? {};
  const told = [p.title ? `title "${p.title}"` : '', p.bodyClass ? `body class "${p.bodyClass}"` : '', ...Object.entries({ ...p.htmlData, ...p.bodyData }).map(([k, v]) => `${k}=${v}`), p.probe !== undefined ? `probe ${JSON.stringify(p.probe)}` : ''].filter(Boolean);
  if (told.length > 0) lines.push(`page reports: ${told.join(', ')}`);
  lines.push(`${inv.browser}, ${inv.viewport.width}x${inv.viewport.height} at ${inv.viewport.dpr}x, waited ${inv.waitSeconds} s`);
  if (inv.processes.length > 0) {
    lines.push(renderTable([{ title: 'process', ...L }, { title: 'rss MB', ...R }, { title: 'footprint MB', ...R }], inv.processes.map((q) => [q.type, String(q.rssMB), q.footprintMB === null ? '-' : String(q.footprintMB)])));
  } else lines.push('(no process figures on this platform)');
  if (inv.heaps.length > 0) {
    lines.push(renderTable([{ title: 'JS context', ...L }, { title: 'used MB', ...R }, { title: 'total MB', ...R }, { title: 'url', ...L }], inv.heaps.map((h) => [h.type, String(h.usedMB), String(h.totalMB), h.url])));
  }
  lines.push(groupedText);
  if (inv.gpu.unknownFormats.length > 0) lines.push(`texture formats whose size is a guess (4 bytes a texel): ${inv.gpu.unknownFormats.join(', ')}`);
  for (const s of inv.snapshots ?? []) lines.push(`heap snapshot ${s.type} ${s.url}: ${s.totalMB} MB`, ...s.top.map((t) => `  ${t}`));
  if (inv.problems.length > 0) lines.push(`page errors: ${inv.problems.join(' | ')}`);
  return lines.join('\n');
}
