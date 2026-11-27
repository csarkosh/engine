/**
 * The deeper sand (`GameLook.sand`) as the terrain's WGSL takes it: the text each of the terrain's slots is filled with, and the
 * sand's functions. A look with no `sand` fills every slot with what stood in its place before (the plain texture reads, nothing
 * added), so the terrain's shader text is the engine's own. A look with one adds, for the pixels whose vertices ask for sand or
 * pebble only (`sdOn`, a branch), the parts whose number is above 0. The text is in `shaders/sand/`, imported with `?raw`.
 *
 * The numbers are written into the text: no uniform is added to the terrain's record or to the frame's block. The tide lines are
 * read from the wet look's level (`wetLevel`, the still sea) so they follow the sea wherever a world puts it.
 *
 * The low tier draws no repeat-breaking (three reads a layer a map) and no ripples (another octave); the rest it draws.
 */
import { lookHasSand, type LookSand } from "../gameLook.js";
import { OLD_WRACK_LINE_M, STORM_LINE_M, WRACK_LINE_M } from "../tideLines.js";
import { WET_RADIUS_MAX } from "../wetSurface.js";
import defsSource from "../shaders/sand/defs.wgsl?raw";
import mainBeginSource from "../shaders/sand/mainBegin.wgsl?raw";
import setupSource from "../shaders/sand/setup.wgsl?raw";
import hexSetupSource from "../shaders/sand/hexSetup.wgsl?raw";
import shadeHeadSource from "../shaders/sand/shadeHead.wgsl?raw";
import lineNoiseSource from "../shaders/sand/lineNoise.wgsl?raw";
import tideSource from "../shaders/sand/tide.wgsl?raw";
import variationSource from "../shaders/sand/variation.wgsl?raw";
import hollowsSource from "../shaders/sand/hollows.wgsl?raw";
import ripplesSource from "../shaders/sand/ripples.wgsl?raw";
import shadeTailSource from "../shaders/sand/shadeTail.wgsl?raw";
import roughSource from "../shaders/sand/rough.wgsl?raw";
import wetPreSource from "../shaders/sand/wetPre.wgsl?raw";
import readsPlainSource from "../shaders/sand/readsPlain.wgsl?raw";
import readsHexSource from "../shaders/sand/readsHex.wgsl?raw";
import wetPlainSource from "../shaders/sand/wetPlain.wgsl?raw";
import wetEdgeExprsSource from "../shaders/sand/wetEdgeExprs.wgsl?raw";
import { fill, wgsl } from "../shaders/shaderText.js";

/** A number as WGSL writes an f32. */
const num = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/** What each of the blend's slots is filled with. */
export type SandBlend = {
  sandSetup: string; rah3Read: string; rah4Read: string; t3Read: string; t4Read: string;
  sandTex: string; pebbleTex: string; sandShade: string; sandRough: string;
};

/** The lines of a file of one expression a line. */
const lines = (source: string): string[] => wgsl(source).split("\n");
const [PLAIN_RAH3, PLAIN_RAH4, PLAIN_T3, PLAIN_T4, PLAIN_SAND, PLAIN_PEBBLE] = lines(readsPlainSource) as [string, string, string, string, string, string];
const [HEX_RAH3, HEX_RAH4, HEX_T3, HEX_T4, HEX_SAND, HEX_PEBBLE] = lines(readsHexSource) as [string, string, string, string, string, string];

/** The blend's slots as the terrain had the text before: the plain reads, nothing added. */
export const NO_SAND_BLEND: SandBlend = {
  sandSetup: "", rah3Read: PLAIN_RAH3, rah4Read: PLAIN_RAH4, t3Read: PLAIN_T3, t4Read: PLAIN_T4,
  sandTex: PLAIN_SAND, pebbleTex: PLAIN_PEBBLE, sandShade: "", sandRough: "",
};

/** The blend's slots for `sand` on a tier (`low`: the low tier). */
export function sandBlend(sand: LookSand | undefined, low: boolean): SandBlend {
  if (!lookHasSand(sand)) return NO_SAND_BLEND;
  const hex = !low && sand.repeat > 0;
  const ripples = !low && sand.ripples > 0;
  const lines = sand.tide > 0 || ripples || sand.wetEdge > 0;
  const shaded = lines || sand.variation > 0 || sand.hollows > 0;
  let shade = "";
  if (shaded) {
    shade = fill(wgsl(shadeHeadSource), { seaRadius: num(WET_RADIUS_MAX) });
    if (lines) shade += `\n${wgsl(lineNoiseSource)}`;
    if (sand.tide > 0) shade += `\n${fill(wgsl(tideSource), { tide: num(sand.tide), wrack: num(WRACK_LINE_M), old: num(OLD_WRACK_LINE_M), storm: num(STORM_LINE_M) })}`;
    if (sand.variation > 0) shade += `\n${fill(wgsl(variationSource), { variation: num(Math.min(sand.variation, 2)) })}`;
    if (sand.hollows > 0) shade += `\n${fill(wgsl(hollowsSource), { hollows: num(sand.hollows) })}`;
    if (ripples) shade += `\n${fill(wgsl(ripplesSource), { ripples: num(Math.min(sand.ripples, 2)) })}`;
    shade += `\n${wgsl(shadeTailSource)}`;
  }
  return {
    sandSetup: wgsl(setupSource) + (hex ? wgsl(hexSetupSource) : ""),
    rah3Read: hex ? HEX_RAH3 : PLAIN_RAH3,
    rah4Read: hex ? HEX_RAH4 : PLAIN_RAH4,
    t3Read: hex ? HEX_T3 : PLAIN_T3,
    t4Read: hex ? HEX_T4 : PLAIN_T4,
    sandTex: hex ? HEX_SAND : PLAIN_SAND,
    pebbleTex: hex ? HEX_PEBBLE : PLAIN_PEBBLE,
    sandShade: shade,
    sandRough: sand.variation > 0 ? fill(wgsl(roughSource), { variation: num(Math.min(sand.variation, 2)) }) : "",
  };
}

/** The sand's functions, a fragment definition; empty for a look with none. */
export function sandDefs(sand: LookSand | undefined): string {
  return lookHasSand(sand) ? `\n${wgsl(defsSource)}` : "";
}

/** The sand's locals the wet look reads, declared at the head of the fragment's main; empty for a look with none. */
export function sandMainBegin(sand: LookSand | undefined): string {
  return lookHasSand(sand) ? wgsl(mainBeginSource) : "";
}

/** What each of the wet look's terrain slots is filled with. */
export type SandWet = { wetPre: string; wetStillExpr: string; wetDampExpr: string; wetGlossExpr: string };

/** The wet look's slots as the terrain had the text before. */
const [PLAIN_STILL, PLAIN_DAMP, PLAIN_GLOSS] = lines(wetPlainSource) as [string, string, string];
const [EDGE_STILL, EDGE_DAMP, EDGE_GLOSS] = lines(wetEdgeExprsSource) as [string, string, string];
export const NO_SAND_WET: SandWet = { wetPre: "", wetStillExpr: PLAIN_STILL, wetDampExpr: PLAIN_DAMP, wetGlossExpr: PLAIN_GLOSS };

/** The wet look's slots for `sand`: the edge's wander, its three-stage fade and the glossy wettest part, where `wetEdge` is above 0. */
export function sandWet(sand: LookSand | undefined): SandWet {
  if (!lookHasSand(sand) || sand.wetEdge <= 0) return NO_SAND_WET;
  return {
    wetPre: `${fill(wgsl(wetPreSource), { wetEdge: num(Math.min(sand.wetEdge, 1)) })}\n`,
    wetStillExpr: EDGE_STILL,
    wetDampExpr: EDGE_DAMP,
    wetGlossExpr: EDGE_GLOSS,
  };
}
