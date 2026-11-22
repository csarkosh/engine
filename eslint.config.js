import tseslint from "typescript-eslint";

const SIM = [
  { group: ["@babylonjs/*"], message: "sim/ must not depend on Babylon." },
  { group: ["**/net/**", "**/game/**"], message: "sim/ must not depend on net/ or game/." },
];
const NET = [
  { group: ["@babylonjs/*"], message: "net/ must not depend on Babylon." },
  { group: ["**/game/**"], message: "net/ must not depend on game/." },
];
const ENGINE = [
  { group: ["@csarkosh/engine", "@csarkosh/engine/**"], message: "Inside the engine, name a module by its relative path." },
  ...serverOff(),
];
const GAME_ON_ENGINE = [
  { group: ["../../src/**", "../../../src/**"], message: "The empty game names the engine by its package, as a game does." },
  ...serverOff(),
];
// The server (`server/`) is a package of its own, released as its own tarball: the engine and the
// empty game never import it, by a path or by its package name.
function serverOff() {
  return [
    {
      group: ["**/server/**", "@csarkosh/engine-server", "@csarkosh/engine-server/**"],
      message: "The server is a package of its own; the engine and the empty game import nothing of it.",
    },
  ];
}
// The server imports nothing of the engine: it ships as a tarball without it. Its files are two
// folders deep (`server/src`, `server/test`), so `../../` leaves the package; its config files
// stand in `server/`, where `../` does.
const SERVER_LEAVES = "The server is a package of its own and imports nothing of the engine (src/, testing/, vite/, tools/ ...), by a path or by its package name.";
const SERVER_NAMES = ["@csarkosh/engine", "@csarkosh/engine/**"];

export default tseslint.config(
  // `.claude/worktrees/` holds whole second checkouts of this repository. Each carries its own
  // tsconfig.json, which gives typescript-eslint a second candidate project root, and it then
  // fails to parse every file in the repository. Flat config does not read .gitignore, so the
  // path has to be named here as well.
  // public/libs/** is the vendored third-party decoder and transcoder JS and wasm glue
  // (tools/vendor-ktx2.mjs): not code this repository authors, so it is not linted.
  { ignores: ["**/dist/**", "**/node_modules/**", ".claude/worktrees/**", "public/libs/**"] },
  ...tseslint.configs.recommended,
  // The engine names its own modules by their paths, never as the package a game imports. A file
  // matched twice takes the last rule whole, so the engine's layers below repeat it.
  {
    files: ["**/*.ts"],
    ignores: ["empty/**", "server/**"],
    rules: { "no-restricted-imports": ["error", { patterns: [...ENGINE] }] },
  },
  // The server is linted by the general rules above (typescript-eslint's) and by this one alone
  // of the engine's rules of layout.
  {
    files: ["server/src/**/*.ts", "server/test/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [{ group: ["../../**", ...SERVER_NAMES], message: SERVER_LEAVES }] }] },
  },
  {
    files: ["server/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [{ group: ["../**", ...SERVER_NAMES], message: SERVER_LEAVES }] }] },
  },
  // The empty game lives in the engine's repository but is a game: it names the engine by the
  // package, as any game does, so that a copy of it is a new game's start; it never reaches into
  // the engine's files by a path.
  {
    files: ["empty/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [...GAME_ON_ENGINE] }] },
  },
  {
    files: ["src/sim/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [...ENGINE, ...SIM] }] },
  },
  {
    files: ["src/net/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [...ENGINE, ...NET] }] },
  },
);
