// Who owns what on a site that several games share. A deploy replaces only what it owns: the files and
// the rules of its own path and, when it also owns the site's root, the files and rules of the root.
// Everything here is pure; the deploy, the rules file and the merged config all ask these functions.

// A rule's pattern begins with a literal first segment: `/dayhike/admin`, `/dayhike/**`, `/dayhike`.
const FIRST_SEGMENT = /^\/[A-Za-z0-9._-]+(\/|$)/;

/** @typedef {{ path: string, root: boolean }} Owner  `path` is `/capesorrow`; `root` says the deploy also owns the site's root. */

/** Whether a file's site path (`/capesorrow/a.js`) is of the path `path`. `/capesorrows/a.js` and `/capesorrow` are not. */
export function isFileOfPath(path, file) {
  return file.startsWith(`${path}/`);
}

/** Whether a file's site path has exactly one segment (`/index.html`, `/favicon.ico`). */
export function isFileOfRoot(file) {
  return /^\/[^/]+$/.test(file);
}

/** Whether the deploy owns the file: of its path, or of the root when it owns the root. */
export function ownsFile(owner, file) {
  return isFileOfPath(owner.path, file) || (owner.root && isFileOfRoot(file));
}

/**
 * The text a rule is judged by: its `glob`, or its `regex` without one leading `^` and without one
 * trailing `$`, so that `^/capesorrow/.*$` reads as `/capesorrow/.*` and `^/capesorrow$` as `/capesorrow`.
 * (The trailing `$` is dropped so that a regex for exactly the path is read as the path; the glob form
 * `/capesorrow` and the regex form then agree.)
 */
export function patternOf(rule) {
  if (typeof rule.regex === 'string') {
    let text = rule.regex;
    if (text.startsWith('^')) text = text.slice(1);
    if (text.endsWith('$')) text = text.slice(0, -1);
    return text;
  }
  return typeof rule.glob === 'string' ? rule.glob : '';
}

/** What a rule shows to a person: its glob or its regex as written. */
export function labelOf(rule) {
  return typeof rule.regex === 'string' ? `regex ${rule.regex}` : String(rule.glob);
}

/** Whether a rule is of the path `path`: its pattern is the path or begins with the path and a slash. */
export function isRuleOfPath(path, rule) {
  const text = patternOf(rule);
  return text === path || text.startsWith(`${path}/`);
}

/** Whether a rule is of some path (its pattern begins with a literal first segment). Every other rule is of the root. */
export function isRuleOfSomePath(rule) {
  return FIRST_SEGMENT.test(patternOf(rule));
}

/** Whether the deploy owns the rule: of its path, or of the root (`/`, `**`, `/*.html`) when it owns the root. */
export function ownsRule(owner, rule) {
  return isRuleOfPath(owner.path, rule) || (owner.root && !isRuleOfSomePath(rule));
}
