// What a run reads from the browser at its end, besides the GPU inventory: each browser
// process's size, each JavaScript context's heap, and (with --heap) the heap by kind of object.
import { execFileSync } from 'node:child_process';

const mbOf = (bytes) => Math.round(bytes / 1048576);

/** The kind of a Chrome process from its command line: `renderer`, `gpu-process`, `utility:network.mojom...`, `browser`. */
export function processKind(command) {
  const type = (command.match(/--type=([a-z-]+)/) ?? [, 'browser'])[1];
  const sub = (command.match(/--utility-sub-type=([\w.]+)/) ?? [, ''])[1];
  return sub === '' ? type : `${type}:${sub}`;
}

/** `ps` lines (`pid rss command`, rss in KB) of the processes whose command line holds `profileDir`. */
export function parsePs(text, profileDir) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.includes(profileDir)) continue;
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (m !== null) out.push({ pid: Number(m[1]), rssKb: Number(m[2]), command: m[3] });
  }
  return out;
}

const psText = () => execFileSync('ps', ['-axo', 'pid=,rss=,command='], { encoding: 'utf8', maxBuffer: 1 << 26 });

/** The physical footprint of a process in MB, from `vmmap` (macOS only); null where it cannot be read. */
function footprintMb(pid) {
  if (process.platform !== 'darwin') return null;
  try {
    const v = execFileSync('vmmap', ['-summary', String(pid)], { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });
    const f = v.match(/Physical footprint:\s+([\d.]+)([KMG])/);
    return f === null ? null : Math.round(Number(f[1]) * { K: 1 / 1024, M: 1, G: 1024 }[f[2]]);
  } catch {
    return null;
  }
}

/** Every process of the browser started on `profileDir`: `{ pid, type, rssMB, footprintMB }`. None on Windows. */
export function readProcesses(profileDir) {
  if (process.platform === 'win32') return [];
  return parsePs(psText(), profileDir).map((p) => ({ pid: p.pid, type: processKind(p.command), rssMB: mbOf(p.rssKb * 1024), footprintMB: footprintMb(p.pid) }));
}

/** The resident size in MB of the page's tab (the largest renderer) and of the GPU process, for the timeline. */
export function residentNow(profileDir) {
  if (process.platform === 'win32') return [0, 0];
  let tab = 0;
  let gpu = 0;
  for (const p of parsePs(psText(), profileDir)) {
    if (p.command.includes('--type=renderer')) tab = Math.max(tab, p.rssKb);
    else if (p.command.includes('--type=gpu-process')) gpu = p.rssKb;
  }
  return [Math.round(tab / 1024), Math.round(gpu / 1024)];
}

/** Each context's heap (the page, its workers), asked of the browser. */
export async function readHeaps(send, sessions) {
  const heaps = [];
  for (const [sessionId, info] of sessions) {
    try {
      const h = await send('Runtime.getHeapUsage', {}, sessionId);
      heaps.push({ type: info.type, url: (info.url ?? '').slice(-60), usedMB: mbOf(h.usedSize), totalMB: mbOf(h.totalSize), embedderMB: mbOf(h.embedderHeapUsedSize ?? 0), backingMB: mbOf(h.backingStorageSize ?? 0) });
    } catch {
      /* a context that went away between listing and asking */
    }
  }
  return heaps;
}

/**
 * A heap snapshot of one context, summed by the kind of object (the constructor's name, or the
 * kind of node), largest first, as lines of text; and for a page, who holds the big array buffers
 * (from each backing store up through the buffer and the typed array to what holds it, by the
 * names of the links). `chunks` is the snapshot's text as the browser streamed it.
 */
export function summariseSnapshot(text, { withHolders }) {
  const snap = JSON.parse(text);
  const F = snap.snapshot.meta.node_fields;
  const T = snap.snapshot.meta.node_types[0];
  const n = F.length;
  const iT = F.indexOf('type');
  const iN = F.indexOf('name');
  const iS = F.indexOf('self_size');
  const by = new Map();
  let total = 0;
  for (let i = 0; i < snap.nodes.length; i += n) {
    const type = T[snap.nodes[i + iT]];
    const name = snap.strings[snap.nodes[i + iN]];
    const size = snap.nodes[i + iS];
    total += size;
    const key = type === 'native' ? `native: ${name.slice(0, 50)}` : type === 'object' ? `object: ${name.slice(0, 40)}` : type === 'array' ? 'array (internal)' : type;
    const e = by.get(key) ?? [0, 0];
    e[0] += size;
    e[1]++;
    by.set(key, e);
  }
  const line = (bytes, count, name) => `${String(mbOf(bytes)).padStart(6)} MB ${String(count).padStart(8)}  ${name}`;
  const top = [...by].sort((a, b) => b[1][0] - a[1][0]).slice(0, 22).map(([k, v]) => line(v[0], v[1], k));
  const holders = withHolders ? arrayBufferHolders(snap, { F, T, n, iT, iN, iS }) : [];
  return { totalMB: mbOf(total), top, holders };
}

function arrayBufferHolders(snap, { F, T, n, iT, iN, iS }) {
  const E = snap.snapshot.meta.edge_fields;
  const ET = snap.snapshot.meta.edge_types[0];
  const en = E.length;
  const jT = E.indexOf('type');
  const jN = E.indexOf('name_or_index');
  const jTo = E.indexOf('to_node');
  const iE = F.indexOf('edge_count');
  const first = new Uint32Array(snap.nodes.length / n + 1);
  for (let i = 0, e = 0; i < snap.nodes.length; i += n) {
    first[i / n] = e;
    e += snap.nodes[i + iE];
    first[i / n + 1] = e;
  }
  const nameOf = (i) => snap.strings[snap.nodes[i + iN]];
  // For each node in `targets`, the strongest node that points at it: a property beats an element beats the rest.
  const up = (targets) => {
    const got = new Map();
    for (let i = 0; i < snap.nodes.length; i += n) {
      for (let e = first[i / n]; e < first[i / n + 1]; e++) {
        const to = snap.edges[e * en + jTo];
        if (!targets.has(to)) continue;
        const et = ET[snap.edges[e * en + jT]];
        if (et === 'weak' || et === 'shortcut') continue;
        const label = et === 'element' || et === 'hidden' ? '[]' : String(['property', 'context', 'internal'].includes(et) ? snap.strings[snap.edges[e * en + jN]] : snap.edges[e * en + jN]);
        const rank = et === 'property' ? 3 : et === 'element' || et === 'context' ? 2 : 1;
        const cur = got.get(to);
        if (cur === undefined || rank > cur.rank) got.set(to, { from: i, label, rank });
      }
    }
    return got;
  };
  const stores = new Map();
  for (let i = 0; i < snap.nodes.length; i += n) {
    if (T[snap.nodes[i + iT]] === 'native' && nameOf(i) === 'system / JSArrayBufferData' && snap.nodes[i + iS] >= 32768) stores.set(i, snap.nodes[i + iS]);
  }
  let level = new Set(stores.keys());
  const chain = new Map([...stores.keys()].map((k) => [k, { at: k, path: [] }]));
  for (let depth = 0; depth < 6; depth++) {
    const r = up(level);
    const next = new Set();
    for (const c of chain.values()) {
      const g = r.get(c.at);
      if (g === undefined) continue;
      c.path.push(`${g.label}<${nameOf(g.from).slice(0, 28)}>`);
      c.at = g.from;
      next.add(g.from);
    }
    level = next;
  }
  const by = new Map();
  for (const [k, c] of chain) {
    const key = c.path.slice(1, 6).join(' <- ');
    const e = by.get(key) ?? [0, 0];
    e[0] += stores.get(k);
    e[1]++;
    by.set(key, e);
  }
  return [...by].sort((a, b) => b[1][0] - a[1][0]).slice(0, 40).map(([k, v]) => `${String(Math.round(v[0] / 104857.6) / 10).padStart(7)} MB ${String(v[1]).padStart(6)}  ${k}`);
}
