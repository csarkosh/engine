// The site's config after a deploy: the live config with this deploy's rules in place of the ones it
// owned, in the order the Hosting rules need. Pure.
import { isRuleOfSomePath, ownsRule } from './owns.mjs';

/** The three lists a deploy owns rules in. Every other key of the config (`cleanUrls`, `i18n` ...) is the site's. */
export const RULE_LISTS = Object.freeze(['redirects', 'rewrites', 'headers']);

/**
 * `live` is the live version's config, `mine` this deploy's rules (`{ redirects, rewrites, headers }`,
 * the API's form), `owner` who the deploy is. Drops from live every rule the deploy owns, adds its own
 * and orders each list:
 *   redirects, rewrites (the first match wins): the rules of some path first, then the rules of the root,
 *     so that a game's rule is met before the root's catch-all;
 *   headers (a later match overrides an earlier one): the root's first, then the paths', so that a
 *     path's rule overrides the root's.
 * In each group the kept rules keep their live order and this deploy's follow in the file's order.
 * An empty list is left out, as the API leaves it out.
 */
export function mergeConfig(live, mine, owner) {
  const config = { ...(live ?? {}) };
  for (const list of RULE_LISTS) {
    const kept = (config[list] ?? []).filter((rule) => !ownsRule(owner, rule));
    const all = [...kept, ...(mine?.[list] ?? [])];
    const ofSomePath = all.filter((rule) => isRuleOfSomePath(rule));
    const ofRoot = all.filter((rule) => !isRuleOfSomePath(rule));
    const ordered = list === 'headers' ? [...ofRoot, ...ofSomePath] : [...ofSomePath, ...ofRoot];
    if (ordered.length > 0) config[list] = ordered;
    else delete config[list];
  }
  return config;
}
