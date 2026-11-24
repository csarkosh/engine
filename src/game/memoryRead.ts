/**
 * What a page holds, as a session's rows tell it: the JS heap the browser says the page uses and the limit it sets, and the bytes the
 * page has asked its WebGPU device to hold (`deviceHeld.ts`). In megabytes, whole numbers.
 *
 * A game's memory is not a thing a player reports: a tab that is discarded or a browser that slows says nothing to the page. These numbers
 * are what a row can carry instead, so that the sessions of a game say how much it holds on the machines it is played on, beside what
 * those machines say they have (`mem`, the browser's own figure for the device's memory).
 *
 * - `heap`, `heapTotal`, `heapLimit`: `performance.memory`, where the browser has it (Chrome and its kin; absent elsewhere, and then
 *   the fields are left out). The browser rounds these and may hold a reading for minutes, so a row's heap is the page's size to within a
 *   few megabytes at some moment lately, not at the row's own instant. It counts the page's own JS heap and its array buffers, not its
 *   workers', and nothing of the GPU.
 * - `gpuBuf`, `gpuTex`: the bytes of the buffers and the textures the device was asked for and has not let go, by arithmetic. What the
 *   page asked for, which a driver and a browser's GPU process hold more than (about twice, measured).
 *
 * Pure, and on no engine: the readings are handed in.
 */
import type { HeldCounts } from "./deviceHeld.js";

/** `performance.memory` as Chrome has it. */
export type HeapReading = { readonly usedJSHeapSize?: number; readonly totalJSHeapSize?: number; readonly jsHeapSizeLimit?: number };

const mb = (bytes: number): number => Math.round(bytes / 1048576);
const known = (value: number | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** The heap's limit for a session's own fields: `{ heapLimit }`, or nothing where the browser does not say. */
export function heapLimitFields(heap: HeapReading | null | undefined): { heapLimit?: number } {
  return heap !== null && heap !== undefined && known(heap.jsHeapSizeLimit) ? { heapLimit: mb(heap.jsHeapSizeLimit) } : {};
}

/** What the page holds now, for a heartbeat or a match's first row: the heap where the browser says, the device's bytes where they are counted. */
export function memoryFields(heap: HeapReading | null | undefined, held: HeldCounts | null): { heap?: number; heapTotal?: number; gpuBuf?: number; gpuTex?: number } {
  const out: { heap?: number; heapTotal?: number; gpuBuf?: number; gpuTex?: number } = {};
  if (heap !== null && heap !== undefined) {
    if (known(heap.usedJSHeapSize)) out.heap = mb(heap.usedJSHeapSize);
    if (known(heap.totalJSHeapSize)) out.heapTotal = mb(heap.totalJSHeapSize);
  }
  if (held !== null) {
    out.gpuBuf = mb(held.bufferBytes);
    out.gpuTex = mb(held.textureBytes);
  }
  return out;
}

/** The browser's reading of the heap, or null where it has none. */
export function readHeap(perf: unknown): HeapReading | null {
  const memory = (perf as { memory?: HeapReading } | null | undefined)?.memory;
  return memory === undefined || memory === null ? null : memory;
}
