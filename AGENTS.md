# engine: working context

`@csarkosh/engine`: a browser game engine (TypeScript shipped as source, Babylon Lite on WebGPU,
WebRTC netcode, deterministic simulation). It is the engine under the game Day Hike and promises no
stable API. See `README.md` for what it is and how a game takes it.

## Layout

- `src/{sim,net,game}`: the engine. `sim/` imports nothing of `net/` or `game/` and no Babylon;
  `net/` nothing of `game/` and no Babylon. ESLint and `test/architecture.test.ts` hold this.
- `src/shell.ts`, `src/app.ts`, `src/identity.ts`: the page a game hands its definition and identity to.
- `assets/`, `public/`: shipped files, in Git LFS. `assets/catalog.json` lists the models.
- `rust/`: the field kernel's crate. Its built module is committed as `src/sim/kernel/fieldWasm.ts`
  and is written only by `npm run kernel:build` (needs rustup); `npm run kernel:check` checks it.
- `test/`: the engine's tests. `testing/`: helpers a game's tests import.
  `testing/moduleFacts.ts` computes, from `src/`, the facts about the engine's modules a game's architecture
  test holds its imports to (which exist, which reach the terrain, which load no Babylon). `testing/pageEntries.ts`
  keeps the old three lists, now computed from it, for games written against 0.1.x.
- `tools/`: plain Node scripts a game runs from its own root, and their tests in `tools/**/test/`.
  `tools/gate.mjs` and `tools/gate/plan.mjs` are a game's push gate, not this repository's.
  `tools/site/deploy.mjs` deploys one game's path of a shared Firebase Hosting site, guarded (`tools/site/README.md`).
  `tools/memory/` measures where a game's memory goes in a headless Chrome (`check.mjs`), groups the GPU inventory (`group.mjs`) and diffs two runs (`diff.mjs`) (`tools/memory/README.md`).
  `tools/new-game.mjs` is run from this checkout, not a game's: it copies `empty/` into a new game under
  its own name, and gives it a server for development (`game.json`, a `Dockerfile` and `server.package.json` for its image). It renames the empty game's names by exact strings and fails if one is gone, so change
  one of those in `empty/` together with the script (`tools/new-game/test/`). It is not in the package.
- `vite/`: the preset. `empty/`: the empty game, which names the engine by the package name
  (`@csarkosh/engine/...`), resolved here through `exports`; ESLint holds that it never uses a relative
  path into `../src`.
- `server/`: the game server, a workspace and its own package, `@csarkosh/engine-server`, released as a second
  tarball of compiled JavaScript. It imports nothing of the engine and the engine nothing of it (ESLint holds
  it); a game gives it a `game.json` (`server/README.md`, `server/example/`). `npm run test:server`.
- `CREDITS.md`: credits of the works of others the engine ships; a test pins it to the shipped files.

Inside the engine, name a module by its relative path, never as `@csarkosh/engine`.

## Scripts

`npm run typecheck`, `npm run lint`, `npm test` (the engine's suite), `npm run test:tools`,
`npm run test:empty`, `npm run test:server`, `npm run dev:empty`, `npm run build:empty`, `npm run new-game -- <folder> --name <name>`,
`npm run kernel:check`.

## Rules

- Tests pin behaviour and text. Never remove or loosen an `expect(`.
- Git LFS: the models, textures, sounds, images and wasm are LFS objects (`.gitattributes`). Never
  re-encode or re-add them another way, and pack a release only from a checkout where they are whole.
- The `test` workflow is started by hand only (`gh workflow run test.yml --ref <branch>`). No push or
  pull request starts it.
- Do not run the whole main suite on a loaded development machine: its time-limited tests fail for no
  reason there. Run named files (`npx vitest run test/game/credits.test.ts`), about a dozen at a time,
  or let the workflow run it. A failure on a time limit is not run again on a loaded machine. The
  tools and the empty game's suites are small and may be run whole.
- The tools read a game's files (stills, views, budgets) from the directory they are run in; their
  tests use fixtures of their own, never a game's files.
- Commits: a Conventional Commits subject under 72 characters, then `## What` (plain prose: what was
  wrong or missing, and what is so now) and `## How` (a short list of files).
