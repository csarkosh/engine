import { aimAt } from '../freecam';
import { GAME_FOV } from '../gameLens';
import type { FreecamView } from '../rendererTypes';

export type Vec3 = readonly [number, number, number];
/** A place `at` the film time `t` (s), looking at the point `look`; `fov` in radians, default `GAME_FOV`. */
export type CameraKey = { t: number; at: Vec3; look: Vec3; fov?: number };
export type CameraPath = { keys: readonly CameraKey[] };

/** What a calm shot stays inside: speed in m/s, turn rate in rad/s, height over the ground in m. */
export type PathLimits = { speed: number; turn: number; clearance: number };
export const COMFORT: PathLimits = { speed: 2, turn: 0.12, clearance: 2 };

const KNOT_FLOOR = 1e-4;

/** Centripetal Catmull-Rom (Barry-Goldman) from `p1` to `p2` at `u` in [0, 1]. */
function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, u: number): Vec3 {
  const knot = (a: Vec3, b: Vec3): number =>
    Math.max(Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])), KNOT_FLOOR);
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const s = t1 + u * (t2 - t1);
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const lerp = (a: number, b: number, ta: number, tb: number): number => a + ((b - a) * (s - ta)) / (tb - ta);
    const a1 = lerp(p0[i]!, p1[i]!, t0, t1);
    const a2 = lerp(p1[i]!, p2[i]!, t1, t2);
    const a3 = lerp(p2[i]!, p3[i]!, t2, t3);
    const b1 = lerp(a1, a2, t0, t2);
    const b2 = lerp(a2, a3, t1, t3);
    out[i] = lerp(b1, b2, t1, t2);
  }
  return out;
}

/** The view at film time `t` (clamped to the first and last keys). Needs two or more keys in order. */
export function samplePath(path: CameraPath, t: number): FreecamView {
  const keys = path.keys;
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  const tc = Math.min(Math.max(t, first.t), last.t);
  let i = 0;
  while (i < keys.length - 2 && tc > keys[i + 1]!.t) i++;
  const k1 = keys[i]!;
  const k2 = keys[i + 1] ?? k1;
  const k0 = keys[i - 1] ?? k1;
  const k3 = keys[i + 2] ?? k2;
  const span = k2.t - k1.t;
  const u = span > 0 ? (tc - k1.t) / span : 0;
  const at = catmullRom(k0.at, k1.at, k2.at, k3.at, u);
  const look = catmullRom(k0.look, k1.look, k2.look, k3.look, u);
  const f1 = k1.fov ?? GAME_FOV;
  const f2 = k2.fov ?? GAME_FOV;
  const { yaw, pitch } = aimAt({ x: at[0], y: at[1], z: at[2] }, { x: look[0], y: look[1], z: look[2] });
  return { x: at[0], y: at[1], z: at[2], yaw, pitch, fov: f1 + (f2 - f1) * u };
}

/** The signed angle from `a` to `b` wrapped into (-π, π]. */
function wrap(d: number): number {
  let r = d % (2 * Math.PI);
  if (r > Math.PI) r -= 2 * Math.PI;
  else if (r <= -Math.PI) r += 2 * Math.PI;
  return r;
}

/**
 * Samples every frame and lists what breaks the limits (empty means good). Each kind of problem is
 * named once with its first time and its worst value. `groundAt` gives the higher of ground and water.
 */
export function checkPath(
  path: CameraPath,
  fps: number,
  limits: PathLimits,
  groundAt: (x: number, z: number) => number,
): string[] {
  const keys = path.keys;
  if (keys.length < 2) return ['the path needs at least two keys'];
  for (let i = 1; i < keys.length; i++) {
    if (!(keys[i]!.t > keys[i - 1]!.t)) {
      return [`keys must be in strictly increasing order of t: key ${i} (t=${keys[i]!.t}) does not follow key ${i - 1} (t=${keys[i - 1]!.t})`];
    }
  }
  const start = keys[0]!.t;
  const end = keys[keys.length - 1]!.t;
  const frames = Math.ceil((end - start) * fps - 1e-9);
  type Worst = { t: number; value: number; worst: number };
  let speed: Worst | null = null;
  let turn: Worst | null = null;
  let clearance: Worst | null = null;
  const note = (w: Worst | null, t: number, value: number, worse: boolean): Worst =>
    w === null ? { t, value, worst: value } : { ...w, worst: worse ? value : w.worst };
  let prev = samplePath(path, start);
  for (let f = 0; f <= frames; f++) {
    const t = Math.min(start + f / fps, end);
    const v = samplePath(path, t);
    const height = v.y - groundAt(v.x, v.z);
    if (height < limits.clearance) clearance = note(clearance, t, height, clearance !== null && height < clearance.worst);
    if (f > 0) {
      const dt = 1 / fps;
      const sp = Math.hypot(v.x - prev.x, v.y - prev.y, v.z - prev.z) / dt;
      if (sp > limits.speed) speed = note(speed, t, sp, speed !== null && sp > speed.worst);
      const tr = Math.max(Math.abs(wrap(v.yaw - prev.yaw)), Math.abs(v.pitch - prev.pitch)) / dt;
      if (tr > limits.turn) turn = note(turn, t, tr, turn !== null && tr > turn.worst);
    }
    prev = v;
  }
  const out: string[] = [];
  if (speed) out.push(`speed over ${limits.speed} m/s from t=${speed.t.toFixed(2)} s (worst ${speed.worst.toFixed(2)} m/s)`);
  if (turn) out.push(`turn rate over ${limits.turn} rad/s from t=${turn.t.toFixed(2)} s (worst ${turn.worst.toFixed(3)} rad/s)`);
  if (clearance) out.push(`clearance under ${limits.clearance} m from t=${clearance.t.toFixed(2)} s (lowest ${clearance.worst.toFixed(2)} m)`);
  return out;
}
