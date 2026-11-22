# @csarkosh/engine

The engine under the game [Day Hike](https://games.csarko.sh/dayhike): a browser game engine in
TypeScript, drawing with Babylon Lite on WebGPU, with WebRTC netcode between peers and a
deterministic simulation that every peer runs the same way.

It is the engine of one game, published so that the game's code is complete and so that a second
game can start from it. It promises no stable API: a module may move, change or go between any two
versions. Versions are `0.<game>.<release>`: the middle number counts the games built on it, the
last one counts its releases.

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
| `tools/` | Plain Node scripts a game runs from its own root: the push gate, the frame-budget harness, the README stills, the build comparison, the kernel's build and the KTX2 vendoring. Their tests stand in `tools/**/test/`. |
| `vite/` | The Vite preset a game's build starts from. |
| `empty/` | The empty game: a game of nothing on the engine alone, with its own `index.html`, Vite config and tests. The smallest example of a game. |

## Taking it for a game

A release attaches a packed tarball. A game depends on that and not on the Git repository, because
the shipped files are in Git LFS and a git dependency would get pointers in place of them:

```json
"@csarkosh/engine": "https://github.com/csarkosh/engine/releases/download/v0.1.0/csarkosh-engine-0.1.0.tgz"
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
page definition, and `empty/vite.config.ts` is its build.

## The empty game

```
npm install
npm run dev:empty
```

This serves the empty game at <http://localhost:5174/empty/>. Inside this repository the game
names the engine by its own package name, which Node, TypeScript and Vite resolve through
`exports` in `package.json` to this repository's folders. A game elsewhere installs the package.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run typecheck` | `tsc` over the engine and over the empty game. |
| `npm run lint` | ESLint, including the rules of layout between `sim/`, `net/` and `game/`. |
| `npm test` | The engine's own tests (`test/`). |
| `npm run test:tools` | The tools' tests. |
| `npm run test:empty` | The empty game's tests. |
| `npm run dev:empty` | The empty game on a dev server. |
| `npm run build:empty` | The empty game built into `empty/dist/`. |
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
- `ENGINE_LAB` names the disk the frame-budget rig scripts write large output to, by default
  `/Volumes/CyrusExtSSD/dayhike-lab`.

## Cutting a release

1. Set `version` in `package.json` and commit it.
2. Tag the commit `v<version>`.
3. On a checkout where the Git LFS files are whole (`git lfs ls-files` shows `*`, not `-`), run
   `npm pack`. It writes `csarkosh-engine-<version>.tgz`, with the shipped files inside.
4. Attach the tarball to a release of that tag.

## Licence

GPL-3.0-only; see `LICENSE`.

## Credits

The works of others the engine ships, and the code of others it carries, are credited under their
licences in [`CREDITS.md`](CREDITS.md). A game shows that list beside its own through
`src/game/engineCredits.ts`.
