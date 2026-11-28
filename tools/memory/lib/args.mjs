// The command lines of the three scripts: the parts with no browser and no disk in them. Each
// parser returns the options or throws an Error that says what is wrong.

export const CHECK_USAGE = `node node_modules/@csarkosh/engine/tools/memory/check.mjs --url <address> \\
    [--label <name>] [--out <folder>] [--wait <seconds>] \\
    [--width <px>] [--height <px>] [--dpr <n>] [--heap] [--probe <expression>] [--chrome <path>]

  --url <address>     the page to measure, a dev server's or a live site's (http or https), as given
  --label <name>      the run's name: the files are <out>/<label>.json and .jpg (default: host and time)
  --out <folder>      where the files go (default tools/memory/runs)
  --wait <seconds>    how long to let the page load and settle before reading (default 90)
  --width, --height   the page's size in CSS pixels (default 1280 x 720)
  --dpr <n>           the device pixel ratio (default 1)
  --heap              also take a heap snapshot of the page and each worker (slow; adds the JS heap by kind of object)
  --probe <expression> a JavaScript expression run in the page at the end; its value is stored as page.probe
  --chrome <path>     the browser to start (default: the CHROME variable, else the usual places)`;

export const GROUP_USAGE = `node node_modules/@csarkosh/engine/tools/memory/group.mjs <inventory.json> \\
    [--by maker|label|kind|full] [--rules <file.json>] [--top <n>] [--json]

  --by <mode>     what makes a group: maker (kind and the application's own code that made it; the default),
                  label (kind, label and format), kind (buffers and textures), full (kind, label, format and maker)
  --rules <file>  a game's own groups, an ordered list of { name, kind, label, format, minBytes, maxBytes, stack }; they win
  --top <n>       print only the n largest groups (default 25)
  --json          print the groups as JSON instead of a table`;

export const DIFF_USAGE = `node node_modules/@csarkosh/engine/tools/memory/diff.mjs <before.json> <after.json> \\
    [--by maker|label|kind|full] [--rules <file.json>] [--top <n>] [--min-kb <n>] [--json]

  --by, --rules   as group.mjs; both inventories are grouped the same way
  --top <n>       print only the n groups that changed most (default 25)
  --min-kb <n>    leave out groups that changed by less than n KB (default 0)
  --json          print the difference as JSON instead of a table`;

export const BY_MODES = ['maker', 'label', 'kind', 'full'];

function number(name, value, { min, max, integer = false }) {
  const n = Number(value);
  if (value === '' || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw new Error(`${name} must be ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}; got ${value}`);
  }
  return n;
}

/** Walks `argv`: `flags` are switches, `valued` take the next word. Returns `{ values, flags, rest }`. */
function walk(argv, { flags = [], valued = [], positional = 0 }) {
  const values = {};
  const on = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (flags.includes(arg)) on[arg] = true;
    else if (valued.includes(arg)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      if (values[arg] !== undefined) throw new Error(`${arg} is given twice`);
      values[arg] = value;
    } else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else rest.push(arg);
  }
  if (rest.length !== positional) {
    throw new Error(positional === 0 ? `unexpected ${rest[0]}` : `expected ${positional} inventory file${positional === 1 ? '' : 's'}, got ${rest.length}`);
  }
  return { values, flags: on, rest };
}

/** The options of `check.mjs`. `help` is true (and nothing else is checked) for `--help`. */
export function parseCheckArgs(argv) {
  if (argv.includes('--help')) return { help: true };
  const { values, flags } = walk(argv, {
    flags: ['--heap'],
    valued: ['--url', '--label', '--out', '--wait', '--width', '--height', '--dpr', '--probe', '--chrome'],
  });
  if (values['--url'] === undefined) throw new Error('--url is required');
  let url;
  try {
    url = new URL(values['--url']);
  } catch {
    throw new Error(`--url is not an address: ${values['--url']}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`--url must be http or https; got ${url.protocol}`);
  const label = values['--label'];
  if (label !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(label)) {
    throw new Error(`--label is a file name: letters, digits, dot, underscore and hyphen, not starting with a symbol; got ${label}`);
  }
  return {
    help: false,
    url: url.href,
    label,
    out: values['--out'] ?? 'tools/memory/runs',
    wait: values['--wait'] === undefined ? 90 : number('--wait', values['--wait'], { min: 0, max: 3600 }),
    width: values['--width'] === undefined ? 1280 : number('--width', values['--width'], { min: 200, max: 7680, integer: true }),
    height: values['--height'] === undefined ? 720 : number('--height', values['--height'], { min: 200, max: 4320, integer: true }),
    dpr: values['--dpr'] === undefined ? 1 : number('--dpr', values['--dpr'], { min: 0.5, max: 4 }),
    heap: flags['--heap'] === true,
    probe: values['--probe'],
    chrome: values['--chrome'],
  };
}

function groupOptions(values) {
  const by = values['--by'] ?? 'maker';
  if (!BY_MODES.includes(by)) throw new Error(`--by must be one of ${BY_MODES.join(', ')}; got ${by}`);
  return {
    by,
    rules: values['--rules'],
    top: values['--top'] === undefined ? 25 : number('--top', values['--top'], { min: 1, max: 100000, integer: true }),
  };
}

/** The options of `group.mjs`. */
export function parseGroupArgs(argv) {
  if (argv.includes('--help')) return { help: true };
  const { values, flags, rest } = walk(argv, { flags: ['--json'], valued: ['--by', '--rules', '--top'], positional: 1 });
  return { help: false, file: rest[0], ...groupOptions(values), json: flags['--json'] === true };
}

/** The options of `diff.mjs`. */
export function parseDiffArgs(argv) {
  if (argv.includes('--help')) return { help: true };
  const { values, flags, rest } = walk(argv, { flags: ['--json'], valued: ['--by', '--rules', '--top', '--min-kb'], positional: 2 });
  return {
    help: false,
    before: rest[0],
    after: rest[1],
    ...groupOptions(values),
    minKb: values['--min-kb'] === undefined ? 0 : number('--min-kb', values['--min-kb'], { min: 0, max: 1e9 }),
    json: flags['--json'] === true,
  };
}
