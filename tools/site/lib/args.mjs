// The deploy's command line: the parts with no network and no disk in them.

export const USAGE = `node node_modules/@csarkosh/engine/tools/site/deploy.mjs \\
    --project <gcp project id> --site <hosting site id> --path /<game> --dir <folder> \\
    [--rules <json file>] [--root-dir <folder>] \\
    [--channel <name> [--expires <days>]] [--message <text>] [--dry-run]

  --project <id>      the Google Cloud project that bills the calls
  --site <id>         the Firebase Hosting site
  --path /<game>      the one path of the site this deploy owns: a slash and one lowercase segment
  --dir <folder>      served under the path: every file in it, but names beginning with "." and *.map
  --rules <file>      redirects, rewrites and headers in firebase.json's syntax, of this path only
  --root-dir <folder> also own the site's root: its files (no subfolders) are served at /<name>,
                      replace every top-level file of the site, and the root's rules may be shipped
  --channel <name>    release to this preview channel (made if missing) in place of live
  --expires <days>    a made channel's life, 1 to 30 (7 by default); needs --channel
  --message <text>    the release's message (a live release; a channel's takes none)
  --dry-run           read the site, print the plan, write nothing`;

const PATH = /^\/[a-z0-9][a-z0-9-]*$/;
const CHANNEL = /^[a-z0-9](?:[a-z0-9-]{0,34}[a-z0-9])?$/;
// Both ids are put into request paths, so they are held to what the services allow.
const PROJECT = /^[a-z][a-z0-9:.-]*[a-z0-9]$/;
const SITE = /^[a-z0-9][a-z0-9-]*$/;
const VALUED = new Set(['--project', '--site', '--path', '--dir', '--rules', '--root-dir', '--channel', '--expires', '--message']);

/** The options of `argv`, or an Error that says what is wrong with it. */
export function parseArgs(argv) {
  const options = {
    project: undefined,
    site: undefined,
    path: undefined,
    dir: undefined,
    rules: undefined,
    rootDir: undefined,
    channel: undefined,
    expires: undefined,
    message: undefined,
    dryRun: false,
  };
  const keys = { '--root-dir': 'rootDir' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (VALUED.has(arg)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      const key = keys[arg] ?? arg.slice(2);
      if (options[key] !== undefined) throw new Error(`${arg} is given twice`);
      options[key] = value;
    } else throw new Error(`unknown option ${arg}`);
  }
  for (const required of ['project', 'site', 'path', 'dir']) {
    if (options[required] === undefined) throw new Error(`--${required} is required`);
  }
  if (!PROJECT.test(options.project)) throw new Error(`--project is not a project id: ${options.project}`);
  if (!SITE.test(options.site)) throw new Error(`--site is not a site id (lowercase letters, digits, hyphens): ${options.site}`);
  if (!PATH.test(options.path)) throw new Error(`--path must be one slash and one segment of lowercase letters, digits and hyphens, like /capesorrow; got ${options.path}`);
  if (options.channel !== undefined && !CHANNEL.test(options.channel)) {
    throw new Error(`--channel must be 1 to 36 lowercase letters, digits and hyphens, not beginning or ending with a hyphen; got ${options.channel}`);
  }
  if (options.expires !== undefined) {
    if (options.channel === undefined) throw new Error('--expires needs --channel');
    const days = Number(options.expires);
    if (!/^\d+$/.test(options.expires) || days < 1 || days > 30) throw new Error(`--expires needs a whole number of days from 1 to 30, got ${options.expires}`);
    options.expires = days;
  } else if (options.channel !== undefined) options.expires = 7;
  return options;
}
