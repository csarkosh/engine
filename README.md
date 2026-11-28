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
"@csarkosh/engine": "https://github.com/csarkosh/engine/releases/download/v0.2.37/csarkosh-engine-0.2.37.tgz"
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

A game's session definition (`SessionGame`) can give a `look`, the part of the engine's look it changes:
the paint filter's strength (`paint`, 0 to 1; at 0 the paint pass is not drawn), the far softening's
radius (`farSoft`), a gain on the weather's exposure (`exposure`), the palette the grade starts in
(`palette`), and the weather and the hour a session starts under (`weather`, `weatherName`, `hour`).
A `finish` (`bands`, `grain`, `edge`, and a `line` drawn from the scene's depth where one thing ends against another,
with its `lineColour` and the two steps in depth it begins at and is full at, `lineFrom` and `lineTo`) is laid over the picture; a game gives a whole one. The line is drawn on every tier (on the low tier, by one extra triangle after the scene's pass that reads its depth); the grain, the darker edge and the bands remain the post chain's, on the medium and high tiers, and the low tier does not draw them.
With every strength 0, the default, the passes' shaders and uniforms are exactly the engine's own.
A game can give `sward`, the colour the ground under the grass is pulled to and how far, where its look darkens the blades and bare ground would show pale.
A game can give `sand` (`LookSand`: six numbers, each 0 for off and 1 for full; spread `SAND_DEFAULT` for all on) for a deeper beach: the sand and pebble read with the grass's hex tiling so the texture's repeat is broken (`repeat`), colour that varies at 0.5 m, 5 m and 30 m (`variation`), tide lines at 0.45, 0.9 and 1.7 m above the still sea (`tide`; the heights are in `src/game/tideLines.ts`), darker hollows in the grain and pebbles (`hollows`), fine ripples from the waterline to half a metre above it (`ripples`), and a ragged, graded wet edge (`wetEdge`). The numbers are written into the terrain's shader text, so a look with no `sand` has the engine's own shader and uniforms and costs nothing more; the low tier draws neither the repeat-breaking nor the ripples.
A game whose day is long can give `grades`, a palette and an exposure's gain (under a clear sky and under full cloud) for each of a few
heights of the sun: the grade wears the two the sun stands between, mixed, at every hour, in place of the one `palette` and `exposure`.
It is a `Partial<GameLook>` (`src/game/gameLook.ts`): what a game leaves out is the engine's own, so a
game that gives none renders as the engine always has.

A game's place (`CoastOverlay`, `src/sim/olympic.ts`, handed to `registerOlympic`) can give a `beach`, which lays things on its sand from the
models the engine already ships, and draws them from the ground clutter's own models, so nothing is downloaded: `beach: {}` turns on heaps of kelp
and eelgrass along the high-tide lines (wandering 10 to 20 cm of height, in clumps with gaps), cobbles and pebble patches (5 to 30 cm, half-sunk, where
the paint lays its pebbles and at the storm line), small driftwood (0.3 to 1.2 m, along the same lines) and dune grass (from the storm line to the soil,
sparse at the line and thicker inland). Each is a density from 0 to 1 that the place may give (`{ wrack, cobbles, driftwood, duneGrass }`; left out, 1; 0, none).
The tide lines stand at 0.9 m (`WRACK_LINE_HEIGHT`), 0.45 m (`OLD_WRACK_LINE_HEIGHT`) and 1.7 m (`STORM_LINE_HEIGHT`) above the still sea (`src/sim/tideLines.ts`).
They are placed by the simulation, so two players compute the same pieces, from random streams of their own; they are solid to nothing, and the place's
densities are part of its level id. A place that gives no `beach` is exactly the world it was: the same clutter, the same streams, the same level id. They are
kept off ground the place has made by the same hooks as the clutter: its `featureMask` (`loose` for the heaps, the cobbles and the driftwood, `clutter` for the
grass), its shore strip, and its `clutterStands` (asked as the litter, a rock, driftwood and grass: `BEACH_STANDS_AS`). The pieces are five draws on every tier (the low tier
draws at most half the density, and a smaller reach); the game registers nothing more.
`beach` can also give `shape` (0 to 1; left out, 1; 0, none), the beach's own ground (`src/sim/beachShape.ts`): a storm ridge above the storm line
(15 to 30 cm over the plain profile, its seaward face a step of 20 to 40 cm over about 2 m, its crest wandering along the shore and breached in places),
cusps along the swash (12 to 30 m apart, horns 10 to 20 cm over the bays), bars and channels on the wet flat (6 to 15 m across, 8 to 15 cm, so the waterline
is irregular and a few channels hold water below the still sea), and hummocks at the back of the sand (3 to 7 m across, 15 to 35 cm), the dune grass leaning
toward their tops. It is laid in terms of height above the still sea and position along the shore, on a bay's shore only (not a headland's, the cove's
headlands or the sea stacks'), over the coast's ground and under the place's own `shapeD` and the road's corridor, so whatever a place cuts afterwards, and the
road's bed, are as they were; the cove keeps half of the ridge, the cusps and the hummocks and none of the bars. The paint, the beach's things, walking and
props all read the one height, so they follow it. A place that gives no `beach`, or `shape: 0`, has the same ground, to the bit, and the same level id as before;
a place with the shape has its constants in its level id. A sample costs nothing more outside -0.8 m to the sand's top (4 m) and at most 5 gradient-noise
evaluations inside it. The sea's own tables (`oceanTables.ts`) read the straight shore profile, not the relief.

A game's server is a package of the engine's, released as a second tarball beside the engine's, so
that running a server needs none of the engine's 116 MB of game files:

```json
"@csarkosh/engine-server": "https://github.com/csarkosh/engine/releases/download/v0.2.37/csarkosh-engine-server-0.2.37.tgz"
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
