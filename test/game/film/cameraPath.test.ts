import { describe, expect, it } from "vitest";
import { COMFORT, checkPath, samplePath, type CameraPath } from "../../../src/game/film/cameraPath.js";
import { GAME_FOV } from "../../../src/game/gameLens.js";

const path: CameraPath = {
  keys: [
    { t: 0, at: [0, 10, 0], look: [0, 0, 100] },
    { t: 10, at: [0, 10, 10], look: [0, 0, 110] },
  ],
};
const flat = (h: number) => () => h;

describe('samplePath', () => {
  it('moves between two keys', () => {
    const v = samplePath(path, 5);
    expect(Math.abs(v.z - 5)).toBeLessThan(1e-9);
    expect(v.y).toBeCloseTo(10, 12);
    expect(v.fov).toBe(GAME_FOV);
  });

  it('clamps time to the first and last keys', () => {
    expect(samplePath(path, -1)).toMatchObject({ x: 0, y: 10, z: 0 });
    expect(samplePath(path, 11)).toMatchObject({ x: 0, y: 10, z: 10 });
  });

  it('aims from the place at the look point and blends fov linearly', () => {
    const v = samplePath({ keys: [
      { t: 0, at: [0, 0, 0], look: [1, 0, 0], fov: 1 },
      { t: 2, at: [0, 0, 0], look: [1, 0, 0], fov: 2 },
    ] }, 1);
    expect(v.yaw).toBeCloseTo(Math.PI / 2, 12);
    expect(v.pitch).toBeCloseTo(0, 12);
    expect(v.fov).toBeCloseTo(1.5, 12);
  });

  it('passes through every key', () => {
    const p: CameraPath = { keys: [
      { t: 0, at: [0, 5, 0], look: [0, 0, 9] },
      { t: 3, at: [4, 6, 2], look: [0, 0, 9] },
      { t: 7, at: [9, 5, 8], look: [0, 0, 9] },
    ] };
    const v = samplePath(p, 3);
    expect([v.x, v.y, v.z]).toEqual([4, 6, 2].map((n) => expect.closeTo(n, 9)));
  });
});

describe('checkPath', () => {
  it('passes a gentle path', () => {
    expect(checkPath(path, 24, COMFORT, flat(0))).toEqual([]);
  });

  it('flags speed', () => {
    const fast: CameraPath = { keys: [path.keys[0]!, { ...path.keys[1]!, at: [0, 10, 100] }] };
    const problems = checkPath(fast, 24, COMFORT, flat(0));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.includes('speed'))).toBe(true);
  });

  it('flags turn rate, wrapping yaw', () => {
    const spin: CameraPath = { keys: [
      { t: 0, at: [0, 10, 0], look: [-0.01, 10, -1] },
      { t: 0.5, at: [0, 10, 0], look: [0.01, 10, -1] },
    ] };
    // yaw goes from about -pi to about +pi (the seam, looking to -z) by a tiny real step: no turn problem
    expect(checkPath(spin, 24, COMFORT, flat(0)).some((p) => p.includes('turn'))).toBe(false);
    const swing: CameraPath = { keys: [
      { t: 0, at: [0, 10, 0], look: [0, 10, 5] },
      { t: 1, at: [0, 10, 0], look: [5, 10, 0] },
    ] };
    expect(checkPath(swing, 24, COMFORT, flat(0)).some((p) => p.includes('turn'))).toBe(true);
  });

  it('flags clearance', () => {
    expect(checkPath(path, 24, COMFORT, flat(9.5)).some((p) => p.includes('clearance'))).toBe(true);
  });

  it('flags keys out of order', () => {
    const bad: CameraPath = { keys: [path.keys[1]!, path.keys[0]!] };
    expect(checkPath(bad, 24, COMFORT, flat(0)).some((p) => p.includes('order'))).toBe(true);
  });

  it('flags a single key', () => {
    const one: CameraPath = { keys: [path.keys[0]!] };
    expect(checkPath(one, 24, COMFORT, flat(0)).some((p) => p.includes('two keys'))).toBe(true);
  });
});
