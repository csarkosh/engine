/**
 * The tide's kelp: the two meshes the beach's wrack draws (`BEACH_KELP`, `sim/beach.ts`), built here from fixed
 * hashes so they need no asset and no download. Babylon-free, like `shrubClump.ts`: the shell
 * (`lite/beachMeshes.ts`) wraps the arrays in meshes and the tests read them directly.
 *
 *  - **The heap** (variant 0): a tangle, not a rosette. `HEAP_RIBBONS` ribbons of different lengths and widths, each
 *    starting at its own place off the middle of the pile and lying mostly along the heap's own direction (x, the
 *    shore), so that it crosses and overlaps its neighbours at off-centre points, and a few `HEAP_STRAYS` thin
 *    ones leave it at an angle. A ribbon curves in plan (an S, not an arc), ripples a little in height, lies on the
 *    sand 2 to 6 cm high where the pile is thickest, tapers to a ragged tip and is dried pale at it. The unit heap
 *    is about a metre long (x) and a third of it across (z).
 *  - **The strand** (variant 1): a single bull-kelp stipe, a ribbon a metre long tapering from a small bulb at one
 *    end to a thread, with two short blades trailing from the bulb. An instance stretches it along x to 1 to 2.5 m.
 *
 * Colours are linear under a white material: dark olive-brown running to a black green, dried to a pale brown at
 * the tips and darkest where the ribbons lie over one another. None is bright or saturated.
 *
 * Renderer-only: nothing here may migrate into sim/ or a tunables registry.
 */
import { hash3 } from "../sim/field.js";

export type KelpGeometry = { positions: Float32Array; normals: Float32Array; colors: Float32Array; indices: Uint16Array };

export const HEAP_RIBBONS = 9;
export const HEAP_STRAYS = 2;
export const HEAP_POINTS = 8;
/** The unit heap's crown height (m): its pile's own, before the ribbons' layers and ripples. */
export const HEAP_CROWN = 0.03;
/** The highest a heap rises (m), layers and ripples included. */
export const HEAP_MAX_HEIGHT = 0.07;
export const STRAND_POINTS = 12;
export const STRAND_BLADES = 2;

const SALT = 0x6b60;
const BODY_DARK: readonly [number, number, number] = [0.034, 0.03, 0.013];
const BODY_GREEN: readonly [number, number, number] = [0.02, 0.028, 0.013];
const TIP: readonly [number, number, number] = [0.075, 0.062, 0.032];
const BULB: readonly [number, number, number] = [0.05, 0.038, 0.016];

type Builder = {
  positions: number[]; normals: number[]; colors: number[]; indices: number[];
};

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** The pile's height under (x, z): a low dome, longer than it is wide. */
function hump(x: number, z: number): number {
  const d = 1 - (x / 0.5) * (x / 0.5) - (z / 0.17) * (z / 0.17);
  return d > 0 ? HEAP_CROWN * d : 0;
}

type Ribbon = {
  sx: number; sz: number; angle: number; length: number; width: number; bend: number; phase: number;
  ripple: number; ripples: number; base: number; points: number; tint: number; pile: boolean;
  /** Where along it the width is greatest, and how fast it tapers at the tip (a share of its length). */
  fat: number;
};

/** Lays one ribbon: a strip of `points` points, two vertices each, curved in plan, rippling in height. */
function ribbon(b: Builder, r: Ribbon, seed: number): void {
  const first = b.positions.length / 3;
  const path: { x: number; y: number; z: number; w: number; t: number }[] = [];
  const ca = Math.cos(r.angle);
  const sa = Math.sin(r.angle);
  for (let k = 0; k < r.points; k++) {
    const t = k / (r.points - 1);
    const along = r.length * t;
    // An S, not an arc: the bend swings both ways along the ribbon.
    const side = r.bend * (Math.sin(Math.PI * t) + 0.4 * Math.sin(2.3 * Math.PI * t + r.phase));
    const x = r.sx + ca * along - sa * side;
    const z = r.sz + sa * along + ca * side;
    const rip = r.ripple * Math.sin(r.ripples * Math.PI * 2 * t + r.phase);
    const y = Math.min(HEAP_MAX_HEIGHT, r.base + (r.pile ? hump(x, z) : 0) + rip);
    // Blunt where it starts, widest near `fat`, thinning to a ragged tip.
    const grow = 0.55 + 0.45 * smooth(0, 0.2, t);
    const taper = 1 - 0.88 * smooth(r.fat, 1, t);
    const ragged = 0.75 + 0.4 * hash3(k, seed, 1, SALT);
    path.push({ x, y: Math.max(0.004, y), z, w: r.width * grow * taper * ragged, t });
  }
  for (let k = 0; k < r.points; k++) {
    const a = path[Math.max(0, k - 1)] as (typeof path)[number];
    const c = path[k] as (typeof path)[number];
    const d = path[Math.min(r.points - 1, k + 1)] as (typeof path)[number];
    let tx = d.x - a.x;
    let ty = d.y - a.y;
    let tz = d.z - a.z;
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    let sx = -tz;
    let sz = tx;
    const sl = Math.sqrt(sx * sx + sz * sz) || 1;
    sx /= sl; sz /= sl;
    let nx = ty * sz;
    let ny = tz * sx - tx * sz;
    let nz = -ty * sx;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    // The pile's middle, where ribbons lie over one another, is darkest; a tip is dried.
    const piled = r.pile ? Math.min(1, c.y / (HEAP_CROWN * 1.4)) : 0;
    const shade = 1 - 0.45 * piled;
    const dry = c.t * c.t * c.t * 0.85;
    const body = BODY_DARK.map((v, i) => v + ((BODY_GREEN[i] as number) - v) * r.tint);
    const cr = ((body[0] as number) + (TIP[0] - (body[0] as number)) * dry) * shade;
    const cg = ((body[1] as number) + (TIP[1] - (body[1] as number)) * dry) * shade;
    const cb = ((body[2] as number) + (TIP[2] - (body[2] as number)) * dry) * shade;
    for (const s of [-1, 1]) {
      // Each edge a little off the path by its own draw, and the one a little lower: a wet strip's ragged curl.
      const edge = c.w * 0.5 * (0.85 + 0.3 * hash3(k, seed, s + 3, SALT));
      b.positions.push(c.x + sx * s * edge, Math.max(0.002, c.y - (s < 0 ? 0.003 : 0.001)), c.z + sz * s * edge);
      b.normals.push(nx, ny, nz);
      b.colors.push(cr, cg, cb, 1);
    }
  }
  for (let k = 0; k < r.points - 1; k++) {
    const v = first + k * 2;
    b.indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
  }
}

function finish(b: Builder): KelpGeometry {
  return { positions: new Float32Array(b.positions), normals: new Float32Array(b.normals), colors: new Float32Array(b.colors), indices: Uint16Array.from(b.indices) };
}

/** The heap's mesh data: always the same arrays. */
export function kelpHeapGeometry(): KelpGeometry {
  const b: Builder = { positions: [], normals: [], colors: [], indices: [] };
  const draw = (i: number, k: number): number => hash3(i, k, 0, SALT);
  for (let i = 0; i < HEAP_RIBBONS + HEAP_STRAYS; i++) {
    const stray = i >= HEAP_RIBBONS;
    // Mostly along the pile's own direction, either way, a little off it; a stray leaves at an angle.
    const way = draw(i, 0) < 0.5 ? 0 : Math.PI;
    const angle = stray
      ? way + (draw(i, 1) < 0.5 ? -1 : 1) * (0.7 + 0.4 * draw(i, 2))
      : way + (draw(i, 1) - 0.5) * 0.4;
    ribbon(b, {
      // Each starts at its own place off the middle, so no ribbon is a spoke from one point.
      sx: (draw(i, 3) - 0.5) * (stray ? 0.5 : 0.3),
      sz: (draw(i, 4) - 0.5) * (stray ? 0.06 : 0.12),
      angle,
      length: stray ? 0.2 + 0.1 * draw(i, 5) : 0.2 + 0.2 * draw(i, 5),
      width: stray ? 0.018 + 0.014 * draw(i, 6) : 0.03 + 0.045 * draw(i, 6),
      bend: (draw(i, 7) < 0.5 ? -1 : 1) * (0.02 + 0.04 * draw(i, 8)),
      phase: draw(i, 9) * Math.PI * 2,
      ripple: 0.003 + 0.006 * draw(i, 10),
      ripples: 1.5 + 1.5 * draw(i, 11),
      base: stray ? 0.004 : 0.004 + 0.003 * i,
      points: HEAP_POINTS,
      tint: draw(i, 12),
      pile: !stray,
      fat: 0.35 + 0.3 * draw(i, 13),
    }, i);
  }
  return finish(b);
}

/** The strand's mesh data: a stipe along x from its bulb at x = -0.5, and two blades trailing from the bulb. */
export function kelpStrandGeometry(): KelpGeometry {
  const b: Builder = { positions: [], normals: [], colors: [], indices: [] };
  ribbon(b, {
    sx: -0.48, sz: 0, angle: 0, length: 0.98, width: 0.034, bend: 0.06, phase: 1.3, ripple: 0.004, ripples: 2.2,
    base: 0.007, points: STRAND_POINTS, tint: 0.3, pile: false, fat: 0.1,
  }, 40);
  for (let i = 0; i < STRAND_BLADES; i++) {
    ribbon(b, {
      sx: -0.46, sz: (i === 0 ? -1 : 1) * 0.012, angle: (i === 0 ? -1 : 1) * 0.16, length: 0.3 + 0.12 * hash3(i, 0, 5, SALT), width: 0.05,
      bend: (i === 0 ? 1 : -1) * 0.03, phase: i * 2, ripple: 0.004, ripples: 1.5, base: 0.005, points: HEAP_POINTS, tint: 0.6, pile: false, fat: 0.3,
    }, 50 + i);
  }
  // The bulb: a low six-sided lump, apex above, a ring about its middle, the base on the sand.
  const first = b.positions.length / 3;
  const cx = -0.5;
  const ring = 6;
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number): void => {
    b.positions.push(x, y, z);
    b.normals.push(nx, ny, nz);
    b.colors.push(BULB[0], BULB[1], BULB[2], 1);
  };
  push(cx, 0.05, 0, 0, 1, 0);
  for (let k = 0; k < ring; k++) {
    const a = (k / ring) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    push(cx + 0.042 * c, 0.022, 0.034 * s, c * 0.8, 0.6, s * 0.8);
  }
  for (let k = 0; k < ring; k++) {
    const a = (k / ring) * Math.PI * 2;
    push(cx + 0.03 * Math.cos(a), 0.003, 0.024 * Math.sin(a), Math.cos(a) * 0.954, 0.3, Math.sin(a) * 0.954);
  }
  for (let k = 0; k < ring; k++) {
    const n = (k + 1) % ring;
    b.indices.push(first, first + 1 + k, first + 1 + n);
    b.indices.push(first + 1 + k, first + 1 + ring + k, first + 1 + n, first + 1 + n, first + 1 + ring + k, first + 1 + ring + n);
  }
  return finish(b);
}
