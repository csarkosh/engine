import credits from "../../CREDITS.md?raw";

/**
 * The engine's credits file as text, in the shape `creditsModel` (`credits.ts`) reads: the works of
 * others the engine ships under `assets/` and the code of others it carries, each under its
 * licence. A game parses it and shows it beside its own credits, so a work shipped in the engine
 * is credited wherever the engine is used.
 */
export const ENGINE_CREDITS: string = credits;
