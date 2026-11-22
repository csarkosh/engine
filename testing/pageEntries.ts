import { engineModules, pureModules, terrainModules } from "./moduleFacts.js";

/**
 * Kept for games written against 0.1.x, which hold their own imports of the engine to these three lists. They
 * were lists kept by hand of the modules Day Hike imports, and a game that imported another module failed its
 * own test until the engine was released again. They are now computed from the engine's own source and so
 * always hold every module there is; new code uses `moduleFacts.ts` (`engineModules`, `pureModules`,
 * `terrainModules`, `babylonFreeModules`, `reaches`). Paths are under the engine's `src/`, without the
 * extension (`shell` is `src/shell.ts`).
 */

/** Every module of the engine: each is one that a game's page may reach (`engineModules`). */
export const PAGE_ENTRIES: readonly string[] = engineModules();

/** The modules whose graph loads no Babylon package at all, Babylon Lite included (`pureModules`). */
export const PURE_ENTRIES: readonly string[] = pureModules();

/** The modules whose graph loads the engine's terrain, `sim/terrain.ts` (`terrainModules`): a thread that names one needs the game's registration of its world. */
export const TERRAIN_ENTRIES: readonly string[] = terrainModules();
