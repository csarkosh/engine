// Compares two GPU inventories written by check.mjs: totals, and each group's bytes and objects
// before and after, the largest changes first, new and vanished groups marked.
import { pathToFileURL } from 'node:url';
import { DIFF_USAGE, parseDiffArgs } from './lib/args.mjs';
import { readJson } from './group.mjs';
import { compileRules, diffInventories } from './lib/inventory.mjs';
import { formatDiff } from './lib/report.mjs';

/** The difference of the parsed options' two files. */
export function run(options) {
  const rules = options.rules === undefined ? [] : compileRules(readJson(options.rules));
  return diffInventories(readJson(options.before), readJson(options.after), { by: options.by, rules });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const options = parseDiffArgs(process.argv.slice(2));
    if (options.help) console.log(DIFF_USAGE);
    else {
      const diff = run(options);
      console.log(options.json ? JSON.stringify(diff, null, 1) : formatDiff(diff, { top: options.top, minKb: options.minKb }));
    }
  } catch (error) {
    console.error(`${error.message}\n\n${DIFF_USAGE}`);
    process.exit(2);
  }
}
