#!/usr/bin/env node
// Deploys one game's path of a Firebase Hosting site shared by several games, without touching the
// others: it builds the new site version from the live one on the server (lib/deploy.mjs) and
// releases it. Run from the game's root (`node node_modules/@csarkosh/engine/tools/site/deploy.mjs`),
// its folders given relative to it. The options are in lib/args.mjs, the whole story in README.md.
//
// The access token comes from `gcloud auth print-access-token`, asked once, here; the library takes
// a token and a fetch, and never runs gcloud itself.
//
// Exit: 0 done (or planned, with --dry-run), 2 for arguments or a rules file it cannot run with, 1 for
// a deploy that failed (nothing is released then).
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { USAGE, parseArgs } from './lib/args.mjs';
import { deploy } from './lib/deploy.mjs';
import { loadRules } from './lib/rules.mjs';

const say = (text) => process.stderr.write(`${text}\n`);

let options;
let rules;
try {
  options = parseArgs(process.argv.slice(2));
  rules = options.rules === undefined ? {} : loadRules(resolve(options.rules), { path: options.path, root: options.rootDir !== undefined });
} catch (error) {
  say(`deploy: ${error instanceof Error ? error.message : error}`);
  say('');
  say(USAGE);
  process.exit(2);
}

function accessToken() {
  const run = spawnSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' });
  if (run.error || run.status !== 0 || run.stdout.trim() === '') {
    throw new Error(`could not get an access token from gcloud (gcloud auth print-access-token): ${run.error?.message ?? run.stderr.trim()}`);
  }
  return run.stdout.trim();
}

try {
  await deploy({
    fetch: globalThis.fetch,
    token: accessToken(),
    log: (line) => process.stdout.write(`${line}\n`),
    sleep: (ms) => delay(ms),
    project: options.project,
    site: options.site,
    path: options.path,
    dir: resolve(options.dir),
    rootDir: options.rootDir === undefined ? undefined : resolve(options.rootDir),
    rules,
    channel: options.channel,
    expiresDays: options.expires,
    message: options.message,
    dryRun: options.dryRun,
  });
} catch (error) {
  say(`deploy: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
