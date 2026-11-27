/**
 * The heights (m above the still sea) at which the tide leaves its lines on a beach.
 *
 * The things a place lays on its beach (`beach.ts`) stand along these lines, and the terrain's sand
 * shading (a change of its own) draws its wet and dry lines at the same heights, so that a heap of
 * kelp lies on a dark line of the paint and not beside it. Change one here and that shading moves
 * with it; the two must never be tuned apart.
 *
 * The sand itself is painted by altitude alone (`classifySurface`, `game/terrainSurface.ts`): it
 * runs up to `SAND_TOP` and fades to soil by `COAST_FADE_END`. Those two are repeated here because
 * `sim/` cannot read `game/`; `test/sim/beach.test.ts` holds each equal to the paint's own.
 */

/** The line of the last high tide: kelp, eelgrass and small debris, thick and in clumps. */
export const WRACK_LINE_HEIGHT = 0.9;
/** The line of an older, lower tide: what is left of its wrack, thinner. */
export const OLD_WRACK_LINE_HEIGHT = 0.45;
/** The line of the winter storms: the last of the beach's cobbles, and where the dune grass begins. */
export const STORM_LINE_HEIGHT = 1.7;
/** Sand runs up to this height (`SAND_TOP`, `game/terrainSurface.ts`). */
export const SAND_TOP_HEIGHT = 4;
/** And has faded to soil by this one (`COAST_FADE_END`, `game/terrainSurface.ts`). */
export const COAST_FADE_END_HEIGHT = 9;
