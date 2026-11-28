// Reading a GPU inventory: who made each entry, how entries group, and what changed between two
// inventories. Pure functions over the JSON `check.mjs` writes (see the README for its shape).

/**
 * A file that is the application's own source: not under `node_modules` and not one of the dev
 * server's own (`.vite`, `@vite`, `@id`). The engine, installed as a package, is part of the
 * application here (it is source the game ships and its code names who asked for a resource), so
 * `node_modules/@csarkosh/engine/` counts as the application's. On a production build every file
 * is a bundle, so every frame is "own" and the maker is only as fine as the bundle's names.
 */
export function isOwnFile(file) {
  if (/(^|\/)(\.vite|@vite|@id|__vite)(\/|$)/.test(file)) return false;
  if (/(^|\/)node_modules\//.test(file)) return /(^|\/)node_modules\/@csarkosh\/engine\//.test(file);
  return true;
}

/** A file path as it reads in a table: the dev server's absolute `@fs/...` path cut back to `src/...`
 * (or to `node_modules/...`), and a bundle's content hash taken out so two builds name it alike. */
export function displayFile(file) {
  let f = file;
  if (f.startsWith('@fs/')) {
    const nm = f.indexOf('node_modules/');
    const src = f.search(/(^|\/)src\//);
    if (nm >= 0) f = f.slice(nm);
    else if (src >= 0) f = f.slice(f[src] === '/' ? src + 1 : src);
    else f = f.split('/').slice(-2).join('/');
  }
  return f.replace(/-(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{8}(?=\.m?js$)/, '');
}

const cleanName = (fn) => fn.replace(/^(async|new) /, '').replace(/ \[as [^\]]*\]$/, '') || '(anonymous)';

/**
 * Who made an entry: the innermost frame of its stack that is the application's own, as
 * `<file> <function>` (no line number, so an edit above does not rename it); with no such frame,
 * the innermost frame that has a function name, else the innermost frame. `{ maker, own }`.
 */
export function makerOf(stack) {
  const name = (f) => `${displayFile(f.file)} ${cleanName(f.fn)}`;
  const own = stack.find((f) => isOwnFile(f.file));
  if (own !== undefined) return { maker: name(own), own: true };
  const named = stack.find((f) => f.fn !== '') ?? stack[0];
  return { maker: named === undefined ? '(no stack)' : name(named), own: false };
}

/**
 * A game's grouping rules from the parsed JSON: an ordered list of
 * `{ name, kind?, label?, format?, minBytes?, maxBytes?, stack? }`. `kind` is "buffer" or
 * "texture"; `label`, `format` and `stack` are regular expressions (the stack's text is one line
 * a frame, `<function> <file>:<line>`); the bytes bound one object's size. Throws on a rule that
 * cannot be read, naming it.
 */
export function compileRules(rules) {
  if (!Array.isArray(rules)) throw new Error('the rules file must be a JSON list of rules');
  return rules.map((rule, i) => {
    const at = `rule ${i + 1}${rule && typeof rule.name === 'string' ? ` (${rule.name})` : ''}`;
    if (rule === null || typeof rule !== 'object' || typeof rule.name !== 'string' || rule.name === '') throw new Error(`${at}: needs a name`);
    for (const key of Object.keys(rule)) {
      if (!['name', 'kind', 'label', 'format', 'minBytes', 'maxBytes', 'stack'].includes(key)) throw new Error(`${at}: unknown key ${key}`);
    }
    if (rule.kind !== undefined && rule.kind !== 'buffer' && rule.kind !== 'texture') throw new Error(`${at}: kind is "buffer" or "texture"`);
    for (const key of ['minBytes', 'maxBytes']) {
      if (rule[key] !== undefined && !(typeof rule[key] === 'number' && rule[key] >= 0)) throw new Error(`${at}: ${key} is a number of bytes`);
    }
    const re = {};
    for (const key of ['label', 'format', 'stack']) {
      if (rule[key] === undefined) continue;
      try {
        re[key] = new RegExp(rule[key]);
      } catch {
        throw new Error(`${at}: ${key} is not a regular expression: ${rule[key]}`);
      }
    }
    return { name: rule.name, kind: rule.kind, minBytes: rule.minBytes, maxBytes: rule.maxBytes, re };
  });
}

const stackText = (stack) => stack.map((f) => `${f.fn} ${f.file}:${f.line}`).join('\n');

function matches(rule, e) {
  if (rule.kind !== undefined && rule.kind !== e.kind) return false;
  const each = e.bytes / Math.max(1, e.count);
  if (rule.minBytes !== undefined && each < rule.minBytes) return false;
  if (rule.maxBytes !== undefined && each > rule.maxBytes) return false;
  if (rule.re.label !== undefined && !rule.re.label.test(e.label)) return false;
  if (rule.re.format !== undefined && !rule.re.format.test(e.format)) return false;
  if (rule.re.stack !== undefined && !rule.re.stack.test(stackText(e.stack))) return false;
  return true;
}

/** The name of the group an entry belongs to: the first rule it matches, else by `mode`. */
export function groupName(e, mode, rules = []) {
  const rule = rules.find((r) => matches(r, e));
  if (rule !== undefined) return rule.name;
  const label = e.label === '' ? '(no label)' : e.label;
  const maker = makerOf(e.stack).maker;
  if (mode === 'kind') return e.kind;
  if (mode === 'label') return `${e.kind} ${label}${e.format === '' ? '' : ` ${e.format}`}`;
  if (mode === 'full') return `${e.kind} ${label}${e.format === '' ? '' : ` ${e.format}`} @ ${maker}`;
  return `${e.kind} @ ${maker}`;
}

/** The inventory's entries, or an Error that says the file is not one. */
export function entriesOf(inventory) {
  const entries = inventory?.gpu?.entries;
  if (!Array.isArray(entries)) {
    throw new Error(inventory?.gpu?.available === false ? 'the page made no WebGPU inventory (no WebGPU device was created)' : 'not an inventory: gpu.entries is missing');
  }
  return entries;
}

/**
 * The inventory grouped. `{ totals: { bufferBytes, textureBytes, bytes, count }, groups: [{ name,
 * bytes, count }] }`, the groups largest first. Totals are summed from the entries.
 */
export function groupInventory(inventory, { by = 'maker', rules = [] } = {}) {
  const totals = { bufferBytes: 0, textureBytes: 0, bytes: 0, count: 0 };
  const groups = new Map();
  for (const e of entriesOf(inventory)) {
    if (e.kind === 'buffer') totals.bufferBytes += e.bytes;
    else totals.textureBytes += e.bytes;
    totals.bytes += e.bytes;
    totals.count += e.count;
    const name = groupName(e, by, rules);
    const g = groups.get(name) ?? { name, bytes: 0, count: 0 };
    g.bytes += e.bytes;
    g.count += e.count;
    groups.set(name, g);
  }
  return { totals, groups: [...groups.values()].sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name)) };
}

/** What the browser reported, as the sums a comparison wants: megabytes by process kind, the page's heap. */
export function browserSums(inventory) {
  const sums = { renderer: 0, gpu: 0, all: 0, pageHeap: null };
  for (const p of inventory.processes ?? []) {
    const size = p.footprintMB ?? p.rssMB ?? 0;
    sums.all += size;
    if (p.type.startsWith('renderer')) sums.renderer += size;
    else if (p.type.startsWith('gpu-process')) sums.gpu += size;
  }
  const page = (inventory.heaps ?? []).find((h) => h.type === 'page');
  if (page !== undefined) sums.pageHeap = page.usedMB;
  return sums;
}

/**
 * Two inventories compared, grouped the same way. `{ before, after, delta, browser, groups }`:
 * the totals of each and their difference; the browser's sums of each; and every group's bytes and
 * count before and after, with `status` "new", "gone" or "changed", ordered by the size of the
 * change (largest first) and then by name. A group that did not change at all is left out.
 */
export function diffInventories(before, after, options = {}) {
  const a = groupInventory(before, options);
  const b = groupInventory(after, options);
  const names = new Map();
  for (const g of a.groups) names.set(g.name, { name: g.name, beforeBytes: g.bytes, beforeCount: g.count, afterBytes: 0, afterCount: 0 });
  for (const g of b.groups) {
    const row = names.get(g.name) ?? { name: g.name, beforeBytes: 0, beforeCount: 0, afterBytes: 0, afterCount: 0, isNew: true };
    row.afterBytes = g.bytes;
    row.afterCount = g.count;
    names.set(g.name, row);
  }
  const groups = [...names.values()]
    .map((r) => ({
      name: r.name,
      beforeBytes: r.beforeBytes,
      afterBytes: r.afterBytes,
      beforeCount: r.beforeCount,
      afterCount: r.afterCount,
      delta: r.afterBytes - r.beforeBytes,
      status: r.isNew ? 'new' : r.afterCount === 0 ? 'gone' : 'changed',
    }))
    .filter((r) => r.delta !== 0 || r.beforeCount !== r.afterCount)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || x.name.localeCompare(y.name));
  const delta = {};
  for (const key of Object.keys(a.totals)) delta[key] = b.totals[key] - a.totals[key];
  return { before: a.totals, after: b.totals, delta, browser: { before: browserSums(before), after: browserSums(after) }, groups };
}
