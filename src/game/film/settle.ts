/**
 * Settling the world before a film frame is kept: the film draws until the world near the camera
 * is built, so no frame is captured while it still streams in.
 */
import { SYNC_LATE_FRAMES_MAX } from "../syncJobs.js";

/** The run of quiet draws after which the world is in: a crossing's job streams from the frame that finds it, and a quiet run of `SYNC_LATE_FRAMES_MAX` frames and two more is a world no job waits on. */
export const SETTLE_FRAMES = SYNC_LATE_FRAMES_MAX + 2;

/**
 * Draws until `SETTLE_FRAMES` draws in a row find `busy()` false, or `maxFrames` draws have been made.
 * `busy` is read after each draw: the film's is `renderer.waitingItems() > 0 || renderer.streaming()`.
 */
export async function settle(
  draw: () => Promise<void>,
  busy: () => boolean,
  maxFrames: number,
): Promise<{ frames: number; settled: boolean }> {
  let frames = 0;
  let quiet = 0;
  while (frames < maxFrames) {
    await draw();
    frames += 1;
    quiet = busy() ? 0 : quiet + 1;
    if (quiet >= SETTLE_FRAMES) return { frames, settled: true };
  }
  return { frames, settled: false };
}
