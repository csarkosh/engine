/**
 * The look a game gives the engine's frame: how far the painted frame
 * replaces the rendered one, how wide the far softening blurs, what the
 * weather's exposure is multiplied by, the palette the grade wears, and the
 * weather and the hour a session starts under, a finish over the picture, and the grade by the sun's height. A game hands the part it
 * changes (`SessionGame.look`); `gameLook` fills in the rest from the
 * engine's own, which is what Day Hike renders with.
 *
 * Loads no engine.
 */
import { PAINT_OILS, mixPalette, type PaintPalette } from "./gradeParams.js";
import { SWARD_FLOOR, SWARD_MAX } from "./groundHexParams.js";
import { FAR_SOFT_RADIUS } from "./postFrame.js";
import { PAINT_STRENGTH } from "./postParams.js";
import { sunPositionAt } from "./sky.js";
import { DEFAULT_HOUR } from "./skyWait.js";
import { DEFAULT_WEATHER, WEATHER_PRESETS, type WeatherParams, type WeatherPresetName } from "./weather.js";

/**
 * A finish over the picture. The tiers with the post chain draw it (medium and high); the low tier has no chain
 * and ignores it. With every strength 0 the passes' shaders and uniforms are the engine's own.
 */
export type LookFinish = {
  /** Film grain: the noise's amplitude in the shown picture's units (0: none). A sister game uses 0.028. */
  readonly grain: number;
  /** A darker edge to the frame, over the grade's own vignette: how much is taken at the corners (0: none). 0.14. */
  readonly edge: number;
  /** A line drawn where one thing ends and another begins, found from the scene's depth: its strength, 0 to 1 (0: none). 0.6. */
  readonly line: number;
  /** What the line multiplies the picture by where it is full. [0.16, 0.17, 0.22]. */
  readonly lineColour: readonly [number, number, number];
  /** How far the picture's light is gathered into five soft bands, 0 to 1 (0: none). 0.25. */
  readonly bands: number;
};

/** No finish: every strength 0. */
export const NO_FINISH: LookFinish = { grain: 0, edge: 0, line: 0, lineColour: [1, 1, 1], bands: 0 };

/** Whether the far softening draws the finish's line. */
export function finishDrawsLine(finish: LookFinish): boolean {
  return finish.line > 0;
}

/** Whether the grade lays the finish's bands, grain or edge over the picture. */
export function finishDrawsInGrade(finish: LookFinish): boolean {
  return finish.grain > 0 || finish.edge > 0 || finish.bands > 0;
}

/** The far softening's `finishLine` uniform: the line's colour, then its strength. */
export function finishLineUniform(finish: LookFinish): [number, number, number, number] {
  return [finish.lineColour[0], finish.lineColour[1], finish.lineColour[2], finish.line];
}

/** The grade's `finishGrade` uniform: the grain's amplitude, the edge's share, the bands' strength. */
export function finishGradeUniform(finish: LookFinish): [number, number, number] {
  return [finish.grain, finish.edge, finish.bands];
}

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
  /** A finish over the picture: bands, grain, an edge and a line from depth. A game gives a whole one or none. Not drawn on the low tier. */
  readonly finish: LookFinish;
  /**
   * The grade by the sun's height, for a game whose day is long: in ascending order of `sun`. Where there are any, the palette and the
   * exposure's gain are theirs at every hour (`lookGradeAt`), and `palette` and `exposure` are not read. Empty: the one palette and the one gain.
   */
  readonly grades: readonly LookGrade[];
  /** The ground under the grass (`LookSward`). */
  readonly sward: LookSward;
};

/**
 * The ground under the grass. Inside the blade field's reach the terrain that carries a sward is pulled toward one colour, the shaded
 * thatch between the blades, so that ground seen between them, or before they are built round an eye that moves fast, reads as the
 * grass does. `floor` is that colour (linear albedo) and `pull` how far the ground is taken to it at full cover, 0 to 1. A look that
 * darkens the blades (a line drawn on every blade's edge does) wants a darker floor and a full pull, or bare ground shows pale.
 */
export type LookSward = { readonly floor: readonly [number, number, number]; readonly pull: number };

/** The grade where the sun stands at one height. */
export type LookGrade = {
  /** The sun's height as `sunPositionAt(hour).y` gives it: 1 overhead, 0 on the horizon, under 0 below it. */
  readonly sun: number;
  /** The palette the grade wears there. */
  readonly palette: PaintPalette;
  /** What the weather's exposure is multiplied by there, under a clear sky. */
  readonly exposure: number;
  /** The same under full cloud: the gain is between the two by the weather's cloud cover. */
  readonly overcast: number;
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
  finish: NO_FINISH,
  grades: [],
  sward: { floor: [SWARD_FLOOR.r, SWARD_FLOOR.g, SWARD_FLOOR.b], pull: SWARD_MAX },
};

/**
 * The palette and the exposure's gain of `look` at `hour` under `cloud` (the weather's cloud cover, 0 to 1), from its grades: the two
 * the sun stands between, mixed by where it stands, and the first or the last past either end. Null where the look has no grades,
 * and the caller reads the look's one palette and gain as it always has.
 */
export function lookGradeAt(look: GameLook, hour: number, cloud: number): { readonly palette: PaintPalette; readonly exposure: number } | null {
  const grades = look.grades;
  if (grades.length === 0) return null;
  const sun = sunPositionAt(hour).y;
  const c = Math.min(1, Math.max(0, cloud));
  const gain = (g: LookGrade): number => g.exposure + (g.overcast - g.exposure) * c;
  let below = grades[0] as LookGrade;
  if (sun <= below.sun) return { palette: below.palette, exposure: gain(below) };
  for (let i = 1; i < grades.length; i++) {
    const above = grades[i] as LookGrade;
    if (sun <= above.sun) {
      const t = (sun - below.sun) / (above.sun - below.sun);
      return { palette: mixPalette(below.palette, above.palette, t), exposure: gain(below) + (gain(above) - gain(below)) * t };
    }
    below = above;
  }
  return { palette: below.palette, exposure: gain(below) };
}

/** A game's look from the part it gives: the engine's own look itself where it gives none, else the engine's with its part over it. */
export function gameLook(own?: Partial<GameLook>): GameLook {
  return own === undefined ? ENGINE_LOOK : { ...ENGINE_LOOK, ...own };
}
