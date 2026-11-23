# @csarkosh/engine-server

The server of a game on the [engine](https://github.com/csarkosh/engine): a Node process
(`ws`) that introduces WebRTC peers in a room and steps out, and takes the pages' telemetry
batches. It names no game in code; a game gives it a settings file, `game.json`, and runs it.

It ships as compiled JavaScript in its own tarball on the engine's release,
`csarkosh-engine-server-<version>.tgz`, apart from the engine's (the engine's tarball carries
116 MB of game files a server has no use for). It promises no stable interface, as the engine does.

## Roles

`ROLE` says which service a process is:

- unset, or any other value: both, signaling on `/ws` and telemetry on `/t`, as in development;
- `signaling`: the rooms only. This is the service that holds the room registry and, with
  `REGISTRY=firestore`, writes the shared store;
- `telemetry`: the batch route `/t` and, where they are on, the admin routes `/admin/*`. It
  reads the store and never writes it, so its account needs no write permission.

Every role answers `GET /healthcheck` with `200` and `ok`. The path is `/healthcheck` and not
`/healthz` because on Google's `*.run.app` the frontend answers the literal `/healthz` itself and
the request never reaches the container. A startup probe, which goes to the container directly,
still passes, so a revision goes healthy while every outside check reads an answer the container
never wrote.

## Environment variables

Every variable the code reads, all optional:

| Variable | What it is for |
| --- | --- |
| `PORT` | The port to listen on. Default `8080`. |
| `ROLE` | `signaling` or `telemetry`; anything else is both (see above). |
| `GAME_SETTINGS` | The path of the game's settings file. Unset, the server reads `server/game.json` under its working directory, else `game.json` there. |
| `BUILD_SHA` | The commit the image was built from, written on every telemetry row the process produces. Default `dev`. |
| `REGISTRY` | Where the rooms live: `memory` (this process's own, right for one instance; the default) or `firestore` (the store instances share, so signaling can run on more than one). |
| `K_REVISION` | The Cloud Run revision, part of this instance's name in the shared store. Default `local`. |
| `ALLOWED_ORIGINS` | Comma-separated origins a browser may reach the server from. Unset or empty, the game's `allowedOrigins` stands; a value that names nothing never opens the server up. |
| `TELEMETRY_IGNORE_IPS` | Comma-separated addresses or CIDR prefixes, either family, whose batches are written marked `tester` and `owner`, so the owner's play is no part of the numbers. An entry that is neither stops the process, naming it. |
| `PLACE_URL`, `PLACE_TOKEN` | A collector's place route and its bearer token, to place each new session's address by city. Without both, no session is placed and the address goes nowhere. |
| `ADMIN_EMAILS` | Comma-separated accounts allowed on the admin routes. With none, the routes are not served at all. |
| `GOOGLE_CLOUD_PROJECT`, `GCP_PROJECT` | The project the telemetry dataset and the store live in (the first that is set). The admin routes need one. |
| `ADMIN_AUTH_PROJECT` | The Firebase project whose ID tokens the admin routes accept. Default: the project above. |
| `TELEMETRY_DATASET` | The BigQuery dataset the saved queries read, where `telemetryDataset` of `game.json` is not the one. |

Google's client libraries read their own variables too (`GOOGLE_APPLICATION_CREDENTIALS`, or the
metadata server on Cloud Run) for the store and the admin data. The server holds no secret in code
and writes none to its log.

## game.json

The settings file. A missing or malformed file stops the process before it listens.

| Field | |
| --- | --- |
| `app` | The id this game's numbers carry on the admin host (the index card's `app`). A non-empty string. |
| `telemetryDataset` | The BigQuery dataset the admin routes read, where `TELEMETRY_DATASET` names none. Letters, digits, `_` and `-` only. |
| `telemetryBucket` | The log bucket the saved queries name in their table, ``<project>.global.<bucket>._AllLogs``. Letters, digits, `_` and `-` only. |
| `allowedOrigins` | A non-empty list of origins (`https://example.com`, no path, no trailing slash) the pages are served from, where `ALLOWED_ORIGINS` names none. The same list checks the socket, the batch route and the admin routes. |
| `queries` | Optional. Where the game's saved telemetry queries are, a path that is not absolute, relative to the folder holding `game.json`. Without it they are looked for in `tools/telemetry/queries` under the working directory. |

`game.example.json` is a start with placeholder values.

### The admin routes and the saved queries

The admin routes (`/admin/live`, `/admin/kpis`, `/admin/query/<name>`, `/admin/session|visitor|match/<id>`)
run saved SQL queries over the game's telemetry on BigQuery. The server does not ship them: they
are the game's files, one `<name>.sql` each, and they must include `funnel`, `lobbies`, `progress`,
`errors`, `players`, `paths`, `kpis`, `places`, `session`, `visitor`, `match` and `now`. A file is read
when a route is asked, never at start-up. A game with no admin page sets no `ADMIN_EMAILS`, has no
queries folder and loses nothing: signaling and telemetry run as ever.

## A game's server image

A game's server is its `game.json`, its saved queries if it has an admin page, a `package.json`
that depends on this package's tarball, and a Dockerfile that installs it and runs it. Read
`example/`: its `Dockerfile` is the whole image (`node:22-alpine`, `npm ci --omit=dev`, the
settings copied to `server/game.json`, `node node_modules/@csarkosh/engine-server/dist/index.js`).

The example's `package.json` depends on the tarball by a `file:` path, so the image can be tested
before any release: pack it (`npm pack` in `server/`), put the tarball, the example's files and a
`package-lock.json` (`npm install --package-lock-only` there) in one folder, and
`docker build` that folder. A game points the dependency at the release instead:

```json
"@csarkosh/engine-server": "https://github.com/csarkosh/engine/releases/download/v0.2.7/csarkosh-engine-server-0.2.7.tgz"
```

and its build context then needs no tarball.

## Developing the server

From a checkout of the engine, `npm install` at the root serves this folder too (it is a
workspace). In `server/`: `npm test`, `npm run build` (compiles into `dist/`), `npm run dev`.
`npm pack` builds first and packs `dist/` and this file.
