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
 * A finish over the picture. The line is drawn on every tier: in the far softening where there is a post chain (medium and high), and on
 * the low tier by its own pass after the scene's (`lite/lineOnly.ts`). The grain, the edge and the bands are the chain's grade's, and the low
 * tier draws none of them. With every strength 0 the passes' shaders and uniforms are the engine's own and the low tier adds nothing.
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
  /**
   * How deep a step must be to be drawn, as a share of the distance to what is behind it: the line begins at `lineFrom` and is full at
   * `lineTo` (`LINE_FROM` and `LINE_TO`, 0.01 and 0.05: a step of a metre is drawn out to 100 m and full within 20). Lower, shallower
   * relief is drawn and from further off, and so is anything laid a few centimetres off a wall; the depth the line reads is kept to
   * about one part in two thousand, so a `lineFrom` much under 0.005 speckles a flat wall.
   */
  readonly lineFrom: number;
  readonly lineTo: number;
  /**
   * How the line thins out with distance, as a draughtsman lifts the pen (all four optional; where they are not said the line is the
   * same at every distance, as it always was). `lineNear` and `lineFar` are two distances in metres: within `lineNear` the line is as
   * it is above, and it eases over the way to `lineFar`, measured in the logarithm of the distance, so that a long reach is a long
   * ease and there is no ring. At `lineFar` and beyond, a step must be `lineFarBand` times deeper to draw (1 or more: the small steps
   * of a far forest or a fold in a slope stop being drawn, and the few that carry the shape stay), and what is drawn is `lineFarWeight`
   * of the line's strength (0 to 1: lighter than near ones). Defaults `LINE_NEAR`, `LINE_FAR`, 1 and 1.
   */
  readonly lineNear?: number;
  readonly lineFar?: number;
  readonly lineFarBand?: number;
  readonly lineFarWeight?: number;
  /** How far the picture's light is gathered into five soft bands, 0 to 1 (0: none). 0.25. */
  readonly bands: number;
};

/** Where a line begins and where it is full, where a game's finish does not say: a step of 1 and of 5 parts in a hundred of the distance behind it. */
export const LINE_FROM = 0.01;
export const LINE_TO = 0.05;

/** Where the line's thinning begins and ends, in metres, where a finish does not say: it then does not thin (band 1, weight 1), so the distances matter to nothing. */
export const LINE_NEAR = 40;
export const LINE_FAR = 600;

/** No finish: every strength 0. */
export const NO_FINISH: LookFinish = { grain: 0, edge: 0, line: 0, lineColour: [1, 1, 1], lineFrom: LINE_FROM, lineTo: LINE_TO, bands: 0 };

/** Whether the finish's line is drawn: in the far softening, or on the low tier by its own pass (`lite/lineOnly.ts`). */
export function finishDrawsLine(finish: LookFinish): boolean {
  return finish.line > 0;
}

/** Whether the grade lays the finish's bands, grain or edge over the picture. */
export function finishDrawsInGrade(finish: LookFinish): boolean {
  return finish.grain > 0 || finish.edge > 0 || finish.bands > 0;
}

/** The far softening's `finishLineBand` uniform: where the line begins and where it is full. */
export function finishLineBandUniform(finish: LookFinish): [number, number] {
  return [finish.lineFrom, finish.lineTo];
}

/**
 * The `finishLineFar` uniform: `lineNear`, `lineFar` (kept apart, so the shader never divides by nothing), the multiple of the band at
 * `lineFar` (not under 1) and the share of the strength left there (0 to 1).
 */
export function finishLineFarUniform(finish: LookFinish): [number, number, number, number] {
  const near = Math.max(finish.lineNear ?? LINE_NEAR, 0.01);
  const far = Math.max(finish.lineFar ?? LINE_FAR, near * 1.01);
  return [near, far, Math.max(finish.lineFarBand ?? 1, 1), Math.min(Math.max(finish.lineFarWeight ?? 1, 0), 1)];
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
  /** A finish over the picture: bands, grain, an edge and a line from depth. A game gives a whole one or none. The low tier draws only its line. */
  readonly finish: LookFinish;
  /**
   * The grade by the sun's height, for a game whose day is long: in ascending order of `sun`. Where there are any, the palette and the
   * exposure's gain are theirs at every hour (`lookGradeAt`), and `palette` and `exposure` are not read. Empty: the one palette and the one gain.
   */
  readonly grades: readonly LookGrade[];
  /** The ground under the grass (`LookSward`). */
  readonly sward: LookSward;
  /**
   * A deeper sand (`LookSand`): the terrain's sand and pebble layers drawn with their texture's repeat broken, colour that varies at three
   * scales, tide lines, darker hollows, ripples at the waterline and a graded, ragged wet edge. Absent, the default: the terrain's shader text
   * and uniforms are the engine's own and nothing is added to what a sand pixel costs.
   */
  readonly sand?: LookSand;
};

/**
 * What a game asks of the beach, six numbers, each 0 for off and 1 for the full strength `SAND_DEFAULT` gives it (a number past 1 is
 * stronger still). They are written into the terrain's shader text when the renderer is made, so a look is fixed for a session and a
 * number at 0 leaves its code out of the shader. Every one is drawn only where the ground is sand or pebble.
 */
export type LookSand = {
  /** Breaks the texture's repeat: sand and pebble are read with the hex tiling the grass has, for colour and normal. Any number above 0 is on (it is a switch); not drawn on the low tier. */
  readonly repeat: number;
  /** Colour variation from arithmetic noise in world space, at three scales: mottling at 0.5 m, damp patches at 5 m (slightly darker and less rough), broad drifts at 30 m (value, and a hue between warmer and greyer sand). Drawn at any distance. */
  readonly variation: number;
  /** Tide lines that follow the height above still sea level (`tideLines.ts`): a dark ragged wrack line, a fainter older one, and a storm line above which the sand is paler and coarser. */
  readonly tide: number;
  /** Cavity: the low parts of the grain and of the pebbles, read from the sand's own height map, are darkened (and the high parts lightened), which is the depth cue under an even sky. */
  readonly hollows: number;
  /** Fine ripples (crests 9 cm apart) along the shore from the waterline to half a metre above it, a tilt of the normal and darker troughs, faded out by 12 m from the eye. Not drawn on the low tier. */
  readonly ripples: number;
  /** The wet band's upper edge wanders with noise and fades from wet to damp to dry over a wider band, and the wettest part is glossier. */
  readonly wetEdge: number;
};

/** Every part of the deeper sand on, at the strength it was tuned at. A game spreads it: `sand: { ...SAND_DEFAULT, ripples: 0 }`. */
export const SAND_DEFAULT: LookSand = { repeat: 1, variation: 1, tide: 1, hollows: 1, ripples: 1, wetEdge: 1 };

/** Whether a look asks for any of the deeper sand. */
export function lookHasSand(sand: LookSand | undefined): sand is LookSand {
  return sand !== undefined && (sand.repeat > 0 || sand.variation > 0 || sand.tide > 0 || sand.hollows > 0 || sand.ripples > 0 || sand.wetEdge > 0);
}

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
