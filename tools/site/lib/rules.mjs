// The rules file a game hands the deploy: `firebase.json`'s own syntax for redirects, rewrites and
// headers, converted to the form the Hosting API keeps them in, and checked to hold only rules this
// deploy owns.
import { readFileSync } from 'node:fs';
import { isRuleOfSomePath, labelOf, ownsRule } from './owns.mjs';

const TOP_KEYS = ['redirects', 'rewrites', 'headers'];

const fail = (message) => {
  throw new Error(message);
};

/** Throws unless `rule` is an object with exactly one of `source` and `regex`, and no key outside `allowed`. */
function checkShape(where, rule, allowed) {
  if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) fail(`${where} is not an object`);
  for (const key of Object.keys(rule)) {
    if (!allowed.includes(key)) fail(`${where} has "${key}", which this tool does not ship (it takes ${allowed.join(', ')})`);
  }
  const hasSource = rule.source !== undefined;
  const hasRegex = rule.regex !== undefined;
  if (hasSource === hasRegex) fail(`${where} needs exactly one of "source" and "regex"`);
  const pattern = hasSource ? rule.source : rule.regex;
  if (typeof pattern !== 'string' || pattern === '') fail(`${where}: "${hasSource ? 'source' : 'regex'}" must be a non-empty string`);
  return hasSource ? { glob: pattern } : { regex: pattern };
}

/**
 * The rules of a parsed rules file in the API's form: `source` becomes `glob`, `destination` becomes
 * `location` (a redirect) or `path` (a rewrite), `type` becomes `statusCode`, and a header list a map.
 * Throws on any key or shape this tool does not ship.
 */
export function convertRules(json) {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) fail('the rules file must hold one JSON object');
  for (const key of Object.keys(json)) {
    if (!TOP_KEYS.includes(key)) fail(`the rules file has "${key}", which this tool does not ship (it takes ${TOP_KEYS.join(', ')})`);
  }
  const lists = {};
  for (const key of TOP_KEYS) {
    if (json[key] !== undefined && !Array.isArray(json[key])) fail(`"${key}" must be a list`);
  }
  lists.redirects = (json.redirects ?? []).map((rule, i) => {
    const where = `redirects[${i}]`;
    const pattern = checkShape(where, rule, ['source', 'regex', 'destination', 'type']);
    if (typeof rule.destination !== 'string' || rule.destination === '') fail(`${where} needs a "destination"`);
    const type = rule.type ?? 301;
    if (!Number.isInteger(type) || type < 300 || type > 399) fail(`${where}: "type" must be a 3xx status code, got ${JSON.stringify(rule.type)}`);
    return { ...pattern, statusCode: type, location: rule.destination };
  });
  lists.rewrites = (json.rewrites ?? []).map((rule, i) => {
    const where = `rewrites[${i}]`;
    // A rewrite to a function or to Cloud Run is the site's business, not a game's: only a path is shipped.
    const pattern = checkShape(where, rule, ['source', 'regex', 'destination']);
    if (typeof rule.destination !== 'string' || !rule.destination.startsWith('/')) fail(`${where} needs a "destination" that is a path beginning with "/"`);
    return { ...pattern, path: rule.destination };
  });
  lists.headers = (json.headers ?? []).map((rule, i) => {
    const where = `headers[${i}]`;
    const pattern = checkShape(where, rule, ['source', 'regex', 'headers']);
    if (!Array.isArray(rule.headers) || rule.headers.length === 0) fail(`${where} needs a non-empty "headers" list of { key, value }`);
    const map = {};
    const seen = new Set();
    for (const [j, header] of rule.headers.entries()) {
      if (header === null || typeof header !== 'object' || typeof header.key !== 'string' || header.key === '' || typeof header.value !== 'string') {
        fail(`${where}.headers[${j}] must be { "key": text, "value": text }`);
      }
      if (seen.has(header.key.toLowerCase())) fail(`${where} sets the header ${header.key} twice`);
      seen.add(header.key.toLowerCase());
      map[header.key] = header.value;
    }
    return { ...pattern, headers: map };
  });
  return lists;
}

/** Throws, naming the rule, unless every rule in `rules` (the API's form) is one `owner` owns. */
export function assertOwned(owner, rules) {
  for (const key of TOP_KEYS) {
    for (const rule of rules[key] ?? []) {
      if (ownsRule(owner, rule)) continue;
      const name = `${key} rule ${labelOf(rule)}`;
      if (isRuleOfSomePath(rule)) {
        fail(`${name} is not of ${owner.path}: a deploy ships only the rules of its own path${owner.root ? ' and of the root' : ''}`);
      }
      fail(`${name} is of the site's root, which this deploy does not own: pass --root-dir to own the root`);
    }
  }
}

/** Reads a rules file and returns its rules in the API's form, checked against `owner`. */
export function loadRules(file, owner) {
  let json;
  try {
    json = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read the rules file ${file}: ${error instanceof Error ? error.message : error}`);
  }
  const rules = convertRules(json);
  assertOwned(owner, rules);
  return rules;
}
