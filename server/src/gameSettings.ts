/**
 * Which game this server serves: the few facts about it the server needs,
 * read at start from a file of the game's (`game.json`, found from the
 * directory the server is started in), so the code itself names no game.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type GameSettings = {
  /** The id this game's numbers carry on the shared admin host (the `app` of the index card). */
  app: string;
  /** The BigQuery dataset read where `TELEMETRY_DATASET` names none. */
  telemetryDataset: string;
  /** The log bucket the saved queries name in their table, `<project>.global.<bucket>._AllLogs`. */
  telemetryBucket: string;
  /**
   * The origins a browser may reach the server from, where `ALLOWED_ORIGINS`
   * names none. They are the origins the browser build is actually served from.
   * Firebase provisions the two default hostnames alongside the custom domain
   * and all three serve the same bundle, so a player who reaches the game by
   * any of them must be able to signal. `localhost:5173` is Vite: in
   * development the page and the socket share that origin because Vite
   * proxies `/ws` through to this server, so what arrives here is the dev
   * server's origin rather than `localhost:8080`. The desktop shell
   * (`desktop/main.cjs`) loads the site itself, so its origin is the first
   * entry. `game.csarko.sh` now serves only the redirect page, so nothing new
   * opens a socket from it; it stays listed for web tabs still holding the old
   * bundle at the old origin and can go at a later server deploy. The admin
   * page (`client/src/admin/`) is served from the shared admin host (csarko.sh's
   * `admin/`) and reads this server's `/admin/*` routes cross-origin, so its
   * origin (`https://admin.csarko.sh`) has to be listed for the routes' CORS
   * check (`admin.ts` reads this same list); the bearer token it sends makes
   * the browser preflight each request. The last, `http://localhost:8788`, is
   * that shell's local preview, so the page can be worked on against
   * production. Neither opens a socket.
   */
  allowedOrigins: readonly string[];
  /**
   * Where the game's saved telemetry queries are, as a path relative to the
   * folder of the settings file. Optional: without it the queries are looked
   * for in `tools/telemetry/queries` under the directory the server runs in.
   * Only the admin routes read them, so a game with no admin page needs none.
   */
  queries?: string;
};

/** The settings and the file they were read from, which `queries` is relative to. */
export type LoadedGameSettings = GameSettings & { file: string };

/** What a bucket or dataset name may hold: it goes into a regular expression and into SQL identifiers. */
const NAME = /^[A-Za-z0-9_-]+$/;

function isOrigin(value: string): boolean {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

/** The settings from the file's text; any failure throws, naming `from` and the field. */
export function parseGameSettings(text: string, from: string): GameSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`${from}: not JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`${from}: not an object`);
  const object = raw as Record<string, unknown>;
  const text_ = (field: string): string => {
    const value = object[field];
    if (typeof value !== "string" || value === "") throw new Error(`${from}: "${field}" must be a non-empty string`);
    return value;
  };
  const app = text_("app");
  const telemetryDataset = text_("telemetryDataset");
  const telemetryBucket = text_("telemetryBucket");
  for (const [field, value] of [["telemetryDataset", telemetryDataset], ["telemetryBucket", telemetryBucket]] as const) {
    if (!NAME.test(value)) throw new Error(`${from}: "${field}" may hold only letters, digits, "_" and "-": "${value}"`);
  }
  const origins = object.allowedOrigins;
  if (!Array.isArray(origins) || origins.length === 0) throw new Error(`${from}: "allowedOrigins" must be a non-empty array`);
  for (const origin of origins) {
    if (typeof origin !== "string" || !isOrigin(origin)) throw new Error(`${from}: "allowedOrigins" holds a value that is not an origin: ${JSON.stringify(origin)}`);
  }
  const settings: GameSettings = { app, telemetryDataset, telemetryBucket, allowedOrigins: origins as string[] };
  if (object.queries !== undefined) {
    const queries = text_("queries");
    if (isAbsolute(queries) || queries.startsWith("/") || queries.startsWith("\\") || /^[A-Za-z]:/.test(queries)) {
      throw new Error(`${from}: "queries" must be a path relative to this file's folder: "${queries}"`);
    }
    return { ...settings, queries };
  }
  return settings;
}

/** The settings file a server started in `cwd` reads: `GAME_SETTINGS` when set, else `server/game.json` there if it exists, else `game.json`. */
export function settingsFileCandidates(cwd: string = process.cwd()): string[] {
  const named = process.env.GAME_SETTINGS;
  if (named) return [named];
  return [join(cwd, "server", "game.json"), join(cwd, "game.json")];
}

/**
 * The settings file: `path` when given, else the first of
 * `settingsFileCandidates` that exists. Where none does, the error names every
 * path tried.
 */
export function loadGameSettings(path?: string, cwd: string = process.cwd()): LoadedGameSettings {
  const candidates = path !== undefined ? [path] : settingsFileCandidates(cwd);
  const file = candidates.find((candidate) => existsSync(candidate));
  if (file === undefined) throw new Error(`game settings file not found: tried ${candidates.join(", ")}; set GAME_SETTINGS to name one`);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`game settings file not readable: ${file} (${error instanceof Error ? error.message : String(error)})`);
  }
  return { ...parseGameSettings(text, file), file };
}

/**
 * Where the saved telemetry queries are: the settings' `queries` resolved
 * against the settings file's folder, else `tools/telemetry/queries` under the
 * directory the server runs in, where a game's own tooling keeps them.
 */
export function queriesDirOf(settings: LoadedGameSettings, cwd: string = process.cwd()): string {
  if (settings.queries !== undefined) return resolve(dirname(settings.file), settings.queries);
  return join(cwd, "tools", "telemetry", "queries");
}
