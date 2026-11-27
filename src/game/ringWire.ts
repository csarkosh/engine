/**
 * What goes round between the page and the world's worker about the terrain's rings: the request, the ring as it is
 * sent, and the lists of buffers a post transfers. Pure functions over arrays; the module imports types only, so the
 * page's client reaches no terrain at run time.
 */
import type { RingArrays, RingSamples } from "./clipmap.js";
import type { RingDrawn } from "./ringBuild.js";

/** A covered ground as it can be sent: without its paved-ground function. `pavedMargin` is null where the page's has no paved ground. */
export type RingCover = { x: number; z: number; reach: number; fine: number; cell: number; pavedMargin: number | null };
/** A ring as the page writes it: what goes round between the threads. */
export type RingSent = { positions: Float32Array; normals: Float32Array; plugin: Float32Array; indices: Uint32Array };
export type WorldRingsRequest = {
  id: number; kind: "rings"; seed: number; variant: string; set: number;
  camX: number; camZ: number; cover: RingCover | null;
  /** What the page has drawn for each of the seven rings, null for none. */
  drawn: (RingDrawn | null)[];
  /** The seven rings' samples, level 0 first: given where the worker holds none for this id, or the page built on its own thread since. */
  samples?: RingSamples[];
  /** Buffers the page no longer reads, for the worker's next rings. */
  spare?: RingSent[];
  /** Drop the set in hand and forget this id's samples; nothing is answered. */
  stop?: boolean;
};

/** The typed arrays of a ring's samples, which a move swaps whole (`RingArrays`). */
export const SAMPLE_ARRAYS = ["h", "hh", "dx", "dz", "colors", "weights", "weights2", "cover", "normals", "lift"] as const satisfies readonly (keyof RingArrays)[];

/** The four buffers of a ring sent, for a post that transfers them. */
export function ringSentTransfer(ring: RingSent): ArrayBuffer[] {
  return [ring.positions, ring.normals, ring.plugin, ring.indices].map((a) => a.buffer as ArrayBuffer);
}

/** The buffers of a request's samples and spare rings, each once, for a post that transfers them. */
export function ringsRequestTransfer(request: WorldRingsRequest): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const ring of request.samples ?? []) for (const name of SAMPLE_ARRAYS) buffers.add(ring[name].buffer as ArrayBuffer);
  for (const ring of request.spare ?? []) for (const buffer of ringSentTransfer(ring)) buffers.add(buffer);
  return [...buffers];
}
