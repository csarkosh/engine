// Types for `preset.mjs`, which a game's Vite config imports as `@csarkosh/engine/vite/preset`.
import type { Plugin, UserConfig } from "vite";

/** Makes every file under `engine/public/` part of the game's site, at its path under the game's base. */
export declare function enginePublic(): Plugin;
/** The id of the page's list of its files of code, which `src/game/codeAhead.ts` reads. */
export declare const CODE_AHEAD_ID: string;
/** The files of code a build made that the page does not load by itself: every chunk but the entries, by name, sorted. */
export declare function codeAheadFiles(bundle: Record<string, { type: string; fileName: string; isEntry?: boolean }>): string[];
/** Lists a build's files of code in its page, for the page to load ahead of the session that uses them. */
export declare function engineCodeAhead(): Plugin;
/** The engine's part of a game's Vite config: the Lite version, the inline rule, the engine's public files and the page's list of its code. */
export declare function enginePreset(): UserConfig;
