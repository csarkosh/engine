# @csarkosh/engine

The engine under the game [Day Hike](https://games.csarko.sh/dayhike): a browser game engine in
TypeScript, drawing with Babylon Lite on WebGPU, with WebRTC netcode between peers and a
deterministic simulation that every peer runs the same way.

It is the engine of one game, published so that the game's code is complete and so that a second
game can start from it. It promises no stable API: a module may move, change or go between any two
versions. Versions are `0.<game>.<release>`: the middle number counts the games built on it, the
last one counts its releases. The branch `main` is the newest game's line (`0.2`); a fix an earlier
game needs lands on that game's own branch (`line/0.1` for Day Hike) and is released from there.

It ships as TypeScript source, not as compiled code. The game's own Vite build compiles it.

## What is in each folder

| Folder | What it holds |
| --- | --- |
| `src/` | The engine. `sim/` is the deterministic simulation (no Babylon, nothing of `net/` or `game/`), `net/` the netcode (no Babylon, nothing of `game/`), `game/` the rendering, audio, input and page, and `shell.ts` the page a game hands its one page definition and one identity to. |
| `assets/` | The files the engine ships: models, textures and sounds, with `catalog.json` listing the models. Stored in Git LFS. |
| `public/` | Files served as they are: the vendored KTX2 decoder and its transcoders. Stored in Git LFS. |
| `rust/` | A small Rust crate whose built WebAssembly is committed as `src/sim/kernel/fieldWasm.ts`. |
| `test/` | The engine's own tests (vitest). |
| `testing/` | Test helpers a game's tests import as `@csarkosh/engine/testing/<name>`. |
| `tools/` | Plain Node scripts a game runs from its own root: the push gate, the frame-budget harness, the README stills, the build comparison, the kernel's build, the KTX2 vendoring and `tools/site/deploy.mjs`, which deploys one game's path of a Firebase Hosting site several games share (`tools/site/README.md`). Their tests stand in `tools/**/test/`. |
| `vite/` | The Vite preset a game's build starts from. |
| `server/` | The game server, its own package `@csarkosh/engine-server`: the signaling server that introduces WebRTC peers in a room, and the telemetry route, in plain Node. Released as its own tarball, compiled, apart from the engine's. A workspace of this repository. |
| `empty/` | The empty game: a game of nothing on the engine alone, with its own `index.html`, Vite config and tests. The smallest example of a game. |

## Taking it for a game

A release attaches a packed tarball. A game depends on that and not on the Git repository, because
the shipped files are in Git LFS and a git dependency would get pointers in place of them:

```json
"@csarkosh/engine": "https://github.com/csarkosh/engine/releases/download/v0.2.13/csarkosh-engine-0.2.13.tgz"
```

The game imports the engine's modules by path under the package name, for example
`@csarkosh/engine/sim/core`, `@csarkosh/engine/shell` and `@csarkosh/engine/testing/timeLimit`.
Its Vite config starts from the preset, which gives the build the Babylon Lite version, the rule
for which assets are never inlined and the engine's `public/` files:

```ts
import { enginePreset } from "@csarkosh/engine/vite/preset";
// export default mergeConfig(enginePreset(), defineConfig({ ... }));
```

A game hands the shell one page definition and one identity (`startShell` in `src/shell.ts`). Read
`empty/` for the least a game is: `empty/src/main.ts` starts the shell, `empty/src/page.ts` is its
page definition, and `empty/vite.config.ts` is its build. The page side is handed `PageHost`, which
says among other things whether the build can reach a signaling server (`signaling`: development, or a
build given `VITE_SIGNALING_URL`). A game can be published before it has a server: a production build
given no address shows no party box and joins no party, and its own landing page says what it will.

A game's server is a package of the engine's, released as a second tarball beside the engine's, so
that running a server needs none of the engine's 116 MB of game files:

```json
"@csarkosh/engine-server": "https://github.com/csarkosh/engine/releases/download/v0.2.13/csarkosh-engine-server-0.2.13.tgz"
```

It holds compiled JavaScript and is told which game it serves by the game's own `game.json`. A game's
server is that file, its saved telemetry queries if it has an admin page, a small `package.json` that
depends on the tarball, and a Dockerfile that installs it and runs it. `server/README.md` says what
the server does, which environment variables it reads and what `game.json` holds, and `server/example/`
is the Dockerfile and the files of such an image.

## The empty game

```
npm install
npm run dev:empty
```

This serves the empty game at <http://localhost:5174/empty/>. Inside this repository the game
names the engine by its own package name, which Node, TypeScript and Vite resolve through
`exports` in `package.json` to this repository's folders. A game elsewhere installs the package.

## Starting a game

```
node tools/new-game.mjs ../my-game --name "My Game"
```

Run from a checkout of this repository. It writes the empty game into the folder (which must not exist or must be empty) under the game's own name, with a `package.json` that installs the engine from the release of this checkout's version. The result is the empty game: it is then given its own world, rules and parts. `--id` sets the short name the game keeps its browser storage under and is served at (`/<id>/`); it defaults to the name in lower case with hyphens.

In the new folder, the first install is `npm install --legacy-peer-deps`: with no lockfile, npm 10.9.9 fails in its own peer resolution without the flag. That install writes the game's `package-lock.json`, and a plain `npm install` works after it. Then `npm run dev`.

The new game also comes with a server for development and the files for its image: `game.json` (the server's settings, allowing the dev server's origin), `server.package.json` and a `Dockerfile` that install only the server's release tarball, and a `.dockerignore`; its `package.json` depends on the server's release and has `dev:server` and `dev:client` scripts. For two players on one machine, run `npm run dev:server` in one terminal and `npm run dev` in another.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run typecheck` | `tsc` over the engine, over the empty game and over the server. |
| `npm run lint` | ESLint, including the rules of layout between `sim/`, `net/` and `game/`, and the one that keeps `server/` and the engine from importing each other. |
| `npm test` | The engine's own tests (`test/`). |
| `npm run test:tools` | The tools' tests. |
| `npm run test:empty` | The empty game's tests. |
| `npm run test:server` | The server's tests (`server/test/`). |
| `npm run dev:empty` | The empty game on a dev server. |
| `npm run build:empty` | The empty game built into `empty/dist/`. |
| `npm run new-game` | Starts a new game from the empty game (see "Starting a game"). |
| `npm run kernel:build` | Builds the Rust crate and writes `src/sim/kernel/fieldWasm.ts`. Needs rustup. |
| `npm run kernel:check` | Fails if the committed module is not what the sources build to. |
| `npm run vendor:ktx2` | Vendors the KTX2 decoder and transcoders into `public/libs/ktx2/`. |
| `npm run pack` | Packs the tarball a release attaches. |

Some of the engine's tests have time limits that a busy machine fails for no reason. The
`test` workflow in `.github/workflows/` runs everything on a clean runner; it is started by hand
only.

## Environment variables

The tools read two:

- `ENGINE_GATE` names a runner the push gate (`tools/gate.mjs`) hands the checkout and its
  arguments to, when the gate is not run in place.
- `ENGINE_LAB` names the folder the frame-budget rig scripts write large output to; the scripts
  hold a default and refuse to run where it is not there.

## Cutting a release

1. Set `version` in `package.json` and in `server/package.json` (they are the same number) and commit
   them.
2. Tag the commit `v<version>`.
3. On a checkout where the Git LFS files are whole (`git lfs ls-files` shows `*`, not `-`), run
   `npm pack`. It writes `csarkosh-engine-<version>.tgz`, with the shipped files inside.
4. In `server/`, run `npm pack`. It compiles the server and writes
   `csarkosh-engine-server-<version>.tgz`, which holds the compiled code and its README and none of
   the engine's files.
5. Attach both tarballs to a release of that tag.

## Licence

GPL-3.0-only; see `LICENSE`.

## Credits

The works of others the engine ships, and the code of others it carries, are credited under their
licences in [`CREDITS.md`](CREDITS.md). A game shows that list beside its own through
`src/game/engineCredits.ts`.
