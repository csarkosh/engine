// What a deploy is going to do, worked out from the live version's files and config and what is on
// disk, and how it is told to the person who runs it. Pure.
import { RULE_LISTS } from './config.mjs';
import { ownsFile, patternOf } from './owns.mjs';

/**
 * Splits the planned files against the live ones. `liveFiles` is `[{ path, hash }]` of the live version,
 * `planned` is `[{ path, hash }]` of what this deploy serves, `owner` who the deploy is.
 * Returns the planned paths that are new, changed and unchanged, the live paths this deploy owns that
 * are no longer planned (removed), and how many live files belong to someone else (kept).
 */
export function diffFiles({ liveFiles, planned, owner }) {
  const live = new Map(liveFiles.map((f) => [f.path, f.hash]));
  const added = [];
  const changed = [];
  const unchanged = [];
  for (const file of planned) {
    if (!live.has(file.path)) added.push(file.path);
    else if (live.get(file.path) !== file.hash) changed.push(file.path);
    else unchanged.push(file.path);
  }
  const wanted = new Set(planned.map((f) => f.path));
  const removed = liveFiles.filter((f) => ownsFile(owner, f.path) && !wanted.has(f.path)).map((f) => f.path).sort();
  const kept = liveFiles.filter((f) => !ownsFile(owner, f.path)).length;
  return { added, changed, unchanged, removed, kept };
}

/** A rule's content as a string that is the same for equal rules whatever the order of their keys. */
const canon = (value) => {
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canon(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

/** One rule in a line: what it matches and what it does. */
export function describeRule(list, rule) {
  const pattern = typeof rule.regex === 'string' ? `regex ${rule.regex}` : patternOf(rule);
  if (list === 'redirects') return `${rule.statusCode} ${pattern} -> ${rule.location}`;
  if (list === 'rewrites') return `${pattern} -> ${rule.path ?? JSON.stringify(rule)}`;
  return `${pattern}: ${Object.entries(rule.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join('; ')}`;
}

/**
 * The merged config's rules as lines in their order, `+` on a rule the site does not have yet, a blank
 * mark on one it has, and `-` lines (after the list) for live rules the merge drops.
 */
export function ruleLines(liveConfig, mergedConfig) {
  const lines = [];
  for (const list of RULE_LISTS) {
    const before = (liveConfig?.[list] ?? []).map(canon);
    const after = (mergedConfig?.[list] ?? []).map(canon);
    const rules = mergedConfig?.[list] ?? [];
    const dropped = (liveConfig?.[list] ?? []).filter((rule) => !after.includes(canon(rule)));
    if (rules.length === 0 && dropped.length === 0) continue;
    lines.push(`  ${list}:`);
    rules.forEach((rule, i) => lines.push(`    ${before.includes(after[i] ?? '') ? ' ' : '+'} ${describeRule(list, rule)}`));
    for (const rule of dropped) lines.push(`    - ${describeRule(list, rule)}`);
  }
  return lines;
}

/** Up to `max` paths of a list, one per line, and a line saying how many more. */
export function listPaths(paths, max = 20) {
  const lines = paths.slice(0, max).map((p) => `    ${p}`);
  if (paths.length > max) lines.push(`    ... and ${paths.length - max} more`);
  return lines;
}

/** The plan as lines for `log`. */
export function planLines({ live, liveFileCount, diff, skipped, liveConfig, mergedConfig }) {
  const lines = [
    `live version ${live}: ${liveFileCount} files`,
    `this deploy's files: ${diff.added.length} new, ${diff.changed.length} changed, ${diff.unchanged.length} unchanged`,
    `skipped on disk: ${skipped.hidden} hidden, ${skipped.maps} .map`,
    `removed from the site: ${diff.removed.length}`,
    ...listPaths(diff.removed),
    `files of others kept: ${diff.kept}`,
    'rules after the deploy (+ added, - removed):',
    ...ruleLines(liveConfig, mergedConfig),
  ];
  return lines;
}
