/**
 * The heights above the still sea level at which a beach's tide lines lie, as the terrain's sand paints them (`sand.tide` in `GameLook`,
 * `shaders/sand/tide.wgsl`): a dark ragged line where the sea left its wrack, a fainter one from an older tide, and the storm line above
 * which the sand is paler and coarser. Raggedness wanders each by 10 to 20 cm in height.
 *
 * They are the simulation's own (`sim/tideLines.ts`), where the beach's scattered objects are placed and its shape is made, so what lies
 * on the sand lies on the line the ground draws: one number each, named here as the paint names them.
 *
 * Loads nothing.
 */
export { OLD_WRACK_LINE_HEIGHT as OLD_WRACK_LINE_M, STORM_LINE_HEIGHT as STORM_LINE_M, WRACK_LINE_HEIGHT as WRACK_LINE_M } from "../sim/tideLines.js";
