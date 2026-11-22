# Site deploy

Deploys one game's path of a Firebase Hosting site that several games share (`games.csarko.sh`
serves `/dayhike` and `/capesorrow` from one site), without touching the others.

A Hosting deploy replaces the whole site: deploy one game with `firebase deploy` and every other
game under the site is gone. This tool builds the new site version from the live one on the server
instead, through the Hosting REST API: it keeps everything the deploy does not own, replaces what it
does, and releases only after it has checked the result.

```bash
node node_modules/@csarkosh/engine/tools/site/deploy.mjs \
  --project <gcp project id> --site <hosting site id> --path /capesorrow \
  --dir dist \
  [--rules site-rules.json] [--root-dir <folder>] \
  [--channel <name> [--expires <days>]] [--message <text>] [--dry-run]
```

Run it from the game's root. It needs `gcloud` signed in to an account that may deploy to the site
(it runs `gcloud auth print-access-token` once, and nothing else of gcloud). The site must already
have a live release: the first deploy of a site is a `firebase deploy`, and this tool only updates it.

| Option | |
| --- | --- |
| `--project` | The Google Cloud project that bills the calls (sent as `x-goog-user-project`). |
| `--site` | The Hosting site id. |
| `--path` | The one path this deploy owns: a slash and one segment of lowercase letters, digits and hyphens (`/capesorrow`). Anything else is refused. |
| `--dir` | Served under the path: every file in it, recursively, at `<path>/<relative path>`. It must exist and hold an `index.html`. Any file or folder whose name begins with `.`, and any file ending `.map`, is skipped, and the summary counts them. |
| `--rules` | A JSON file `{ "redirects": [...], "rewrites": [...], "headers": [...] }` in `firebase.json`'s own syntax (`source` or `regex`, `destination`, `type`, a `headers` list of `{ key, value }`). Any other top-level key is refused, and so is a rewrite to anything but a destination path (a `function` or `run`). |
| `--root-dir` | Also own the site's root, see below. |
| `--channel`, `--expires` | Release to this preview channel in place of live. The channel is made if it is missing, living `--expires` days (1 to 30, 7 by default). Live is not touched. |
| `--message` | The message of a live release (`Deploy /capesorrow` by default). |
| `--dry-run` | Read the live version and its files, print the plan, write nothing. |

## What a deploy owns

A file is **of a path** when its site path begins with the path and a slash (`/dayhike/a.js` is of
`/dayhike`; `/dayhikes/a.js` and `/dayhike` are not). A file is **of the root** when it has exactly one
segment (`/index.html`, `/favicon.ico`).

A rule is **of a path** when its pattern (its glob, or its regex without a leading `^` and a trailing
`$`) is the path or begins with the path and a slash. A rule is **of some path** when its pattern
begins with a literal first segment (`/dayhike/admin`, `/dayhike/**`); every other rule is **of the
root** (`/`, `**`, `/*.html`).

A deploy owns the files and the rules of its `--path`. With `--root-dir` it owns those of the root too.
Everything else is another game's and is kept as it is, file by file and rule by rule. The rules file may
hold only rules the deploy owns: a game without `--root-dir` cannot ship `**`, and nobody ships another
game's path. A refused rule is named in the message.

The game that owns the root passes `--root-dir <folder>`. The files directly in that folder (no
subfolders: a subfolder there is an error) are served at `/<name>`, and they replace every top-level file
of the site; the folder's `.`-names and `.map` files are skipped as in `--dir`. Without it, top-level
files are left as they are.

## The config

The new version's config is the live one with the deploy's owned rules dropped and its own added, and
then ordered: in `redirects` and `rewrites` (the first match wins) the rules of some path come first and
the rules of the root after them, so a game's rule is met before the root's `**`; in `headers` (a later
match overrides an earlier one) the root's come first and the paths' after. Within a group the kept
rules keep their order and the deploy's follow in the file's order. Every other key of the config
(`cleanUrls`, `trailingSlashBehavior` ...) is carried over unchanged. Deploying the same rules twice gives
the same config, and a rule taken out of the file is taken off the site.

## What it does

1. Reads the live version and its file list; prints the plan: the live version, how many of the
   deploy's own files are new, changed and unchanged, which owned files will be removed (up to 20 are
   listed), how many files of others are kept, and the merged rules marked `+` (added) and `-` (removed).
   `--dry-run` stops here.
2. Clones the live version on the server with `exclude.regexes` for what the deploy owns
   (`^/capesorrow/.*$`, and `^/[^/]+$` with `--root-dir`).
3. Adds the local files in batches of 1000 and uploads, 8 at a time, only the gzipped files the site does
   not already have (each retried twice on a network error or a 5xx).
4. Puts the merged config on the version and finalizes it.
5. Runs the guard, below.
6. For a live release, reads the live version again (see "two games at once").
7. Releases to live or to the channel, and prints the version, the counts and, for a channel, its address.

Any failure after the clone and before the release deletes the new version. If that delete fails too,
the message says so and names the version.

## The guard

Before any release the tool lists the new version's files and checks three things:

- every live file the deploy does not own is in the new version with the same hash;
- every planned file is in the new version with its hash;
- the new version holds no other file the deploy owns.

Any miss deletes the new version and fails with the list (the first 20 paths). Nothing is released. The
guard is what makes this safe to run against a site whose other games it cannot see.

## Two games deploying at once

The clone is of the live version as it was read. If another game's deploy releases while this one runs, a
release of this version would put the site back as it was before that deploy. So a live release reads the
live version again just before releasing, and if it is no longer the one cloned, deletes the new version
and fails with "the site changed while this deploy ran; run it again". Run it again: the second run
builds on what the other game released. The check leaves the few seconds between that read and the
release, which the API gives no way to close; two deploys that start together can still race there. A channel release cannot
wipe live, and makes no such check.

## Rolling a game back

Deploy the game's older build again with the same command. Only that game's path changes. A rollback in
Firebase's console rolls the whole site back to an earlier version, and every game with it.

## Tests

`npm run test:tools` runs this tool's tests against a small in-memory fake of the Hosting API
(`test/fakeHosting.mjs`); no test touches the network or runs gcloud.
