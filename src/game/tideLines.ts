/**
 * The heights above the still sea level at which a beach's tide lines lie. The terrain's sand paints them (`sand.tide` in `GameLook`,
 * `shaders/sand/tide.wgsl`) as a dark ragged line where the sea left its wrack, a fainter one from an older tide, and the storm line
 * above which the sand is paler and coarser. Raggedness wanders each by 10 to 20 cm in height.
 *
 * The beach's scattered objects (the wrack, weed and driftwood a beach carries, in `src/sim/`) are to be placed at these same heights, so
 * that what lies on the sand lies on the line the ground draws. `sim/` imports nothing of `game/`, so a sim module that places them
 * carries these three numbers itself (or this file moves to `sim/` and `game/` imports it from there).
 *
 * Loads nothing.
 */

/** Metres above still sea level of the fresh wrack line. */
export const WRACK_LINE_M = 0.9;
/** Of the fainter, older line. */
export const OLD_WRACK_LINE_M = 0.45;
/** Of the storm line: the highest water the beach has seen, with the paler, coarser sand above it. */
export const STORM_LINE_M = 1.7;
