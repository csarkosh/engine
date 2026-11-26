/**
 * The look a game gives the engine's frame: how far the painted frame
 * replaces the rendered one, how wide the far softening blurs, what the
 * weather's exposure is multiplied by, the palette the grade wears, and the
 * weather and the hour a session starts under. A game hands the part it
 * changes (`SessionGame.look`); `gameLook` fills in the rest from the
 * engine's own, which is what Day Hike renders with.
 *
 * Loads no engine.
 */
import { PAINT_OILS, type PaintPalette } from "./gradeParams.js";
import { FAR_SOFT_RADIUS } from "./postFrame.js";
import { PAINT_STRENGTH } from "./postParams.js";
import { DEFAULT_HOUR } from "./skyWait.js";
import { DEFAULT_WEATHER, WEATHER_PRESETS, type WeatherParams, type WeatherPresetName } from "./weather.js";

export type GameLook = {
  /** How far the painted frame replaces the rendered one, 0 to 1. At 0 the paint pass is not drawn. */
  readonly paint: number;
  /** The far softening's radius, pixels. At 0 the far frame is left sharp; the ground cloud is still marched. */
  readonly farSoft: number;
  /** What the weather's exposure is multiplied by. */
  readonly exposure: number;
  /** The palette the grade wears until one is set by name. */
  readonly palette: PaintPalette;
  /** The weather a session starts under. */
  readonly weather: WeatherParams;
  /** The engine's preset that weather stands for where a preset is read by name (the lakes' calm). */
  readonly weatherName: WeatherPresetName;
  /** The hour a session starts at. */
  readonly hour: number;
};

/** The engine's own look: the constants the frame is drawn with when a game changes none. */
export const ENGINE_LOOK: GameLook = {
  paint: PAINT_STRENGTH,
  farSoft: FAR_SOFT_RADIUS,
  exposure: 1,
  palette: PAINT_OILS,
  weather: WEATHER_PRESETS[DEFAULT_WEATHER],
  weatherName: DEFAULT_WEATHER,
  hour: DEFAULT_HOUR,
};

/** A game's look from the part it gives: the engine's own look itself where it gives none, else the engine's with its part over it. */
export function gameLook(own?: Partial<GameLook>): GameLook {
  return own === undefined ? ENGINE_LOOK : { ...ENGINE_LOOK, ...own };
}
