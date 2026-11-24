/**
 * The ground's height for a question asked many times a frame and answered roughly: is a hill between the eye and an
 * animal. The analytic ground (`elevationAt`) is the whole terrain, noise on noise with its derivatives, and every
 * sample of it makes its numbers anew: the wildlife director's line of sight, four samples a unit for every unit it
 * weighs on every frame, made about 36 MB of short-lived objects a second with the player standing still.
 *
 * This is the same ground read off a lattice: the exact height at each corner of a square grid, `cell` metres apart,
 * kept in a table as it is first asked for, and the height between corners by weighting the four round the point. A
 * sightline that is asked again next frame, or one a metre along from it, reads corners already held and computes
 * nothing; a walk across new ground computes each new corner once. The table is a fixed size and addressed by a hash of
 * the corner, so a corner that lands where another is held takes its place (and is computed again if asked for later):
 * nothing grows, and nothing is ever wrong, only recomputed.
 *
 * It is not the simulation's ground. Between corners it is off by what the ground curves in `cell` metres (centimetres
 * on a slope, more over a sharp bank), which a test of sight does not see and a foot on the ground would: what stands
 * on the ground asks the exact one.
 */

/** The ground as the lattice answers it. */
export type LatticeGround = ((x: number, z: number) => number) & {
  /** Corners computed since it was made: for a test, and for telling how much the lattice saves. */
  readonly computed: () => number;
};

/**
 * A lattice over `exact`, with corners `cell` metres apart and room for 2^`bits` of them (32,768 by default: a square
 * 360 m on a side at 2 m, more than the director looks across).
 */
export function createGroundLattice(exact: (x: number, z: number) => number, cell = 2, bits = 15): LatticeGround {
  const size = 1 << bits;
  const mask = size - 1;
  const keyX = new Int32Array(size);
  const keyZ = new Int32Array(size);
  const height = new Float64Array(size);
  const held = new Uint8Array(size);
  let computed = 0;
  const corner = (ix: number, iz: number): number => {
    const at = (Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663)) & mask;
    if (held[at] === 1 && keyX[at] === ix && keyZ[at] === iz) return height[at] as number;
    const h = exact(ix * cell, iz * cell);
    keyX[at] = ix;
    keyZ[at] = iz;
    height[at] = h;
    held[at] = 1;
    computed++;
    return h;
  };
  const ground = (x: number, z: number): number => {
    const gx = x / cell;
    const gz = z / cell;
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const u = gx - ix;
    const w = gz - iz;
    const a = corner(ix, iz);
    const b = corner(ix + 1, iz);
    const c = corner(ix, iz + 1);
    const d = corner(ix + 1, iz + 1);
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  };
  return Object.assign(ground, { computed: () => computed });
}
