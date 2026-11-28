// Groups a GPU inventory written by check.mjs: by kind, by label and format, or by maker, and
// prints the largest groups. `node tools/memory/group.mjs --help` says how; README.md says why.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { GROUP_USAGE, parseGroupArgs } from './lib/args.mjs';
import { compileRules, groupInventory } from './lib/inventory.mjs';
import { formatGroups } from './lib/report.mjs';

export const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read ${file}: ${error.message}`);
  }
};

/** The grouped inventory of the parsed options. */
export function run(options) {
  const rules = options.rules === undefined ? [] : compileRules(readJson(options.rules));
  return groupInventory(readJson(options.file), { by: options.by, rules });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const options = parseGroupArgs(process.argv.slice(2));
    if (options.help) console.log(GROUP_USAGE);
    else {
      const grouped = run(options);
      console.log(options.json ? JSON.stringify(grouped, null, 1) : formatGroups(grouped, options.top));
    }
  } catch (error) {
    console.error(`${error.message}\n\n${GROUP_USAGE}`);
    process.exit(2);
  }
}
