/**
 * The hike's draws while the intro's film covers it.
 *
 * A start with an intro builds its world under the film and draws it there,
 * unseen, so its shaders, its pipelines and its buffers are made before the
 * cut. Drawn every frame, that hidden world took the graphics chip from the
 * film: on a phone (WebGL2) 1.8 s of the film's first 53 passed with no frame
 * presented for them (the picture stood, then jumped); drawn four times a
 * second, none (2026-11-11, the owner's phone, each a first visit; by each
 * frame's own film time and count of frames presented). A laptop has the
 * chip to spare: held to four draws a second, its load waited on the draws,
 * each of which asks for a few pipelines and no more.
 *
 * So while a film covers the hike it is drawn at the pace the film affords
 * (`loadPace.ts`): every `COVERED_DRAW_MS` at the floor, where a cover with
 * no film to read stays, and up to every frame while the film keeps its
 * frames; and every frame again from the cut. A new thing's first draw is a
 * quarter second after it arrives at the latest.
 *
 * Only the film's cover: the quality probe's screen covers play too, and
 * times the frames it covers.
 */
import type { LoadPace } from "./loadPace.js";

/** The time between a covered hike's draws at the floor (ms). */
export const COVERED_DRAW_MS = 250;

export type CoveredDraw = {
  /**
   * A film covers the hike from now until the function returned is called (once; again does nothing).
   * `pace` is the film's (`loadPace.ts`): with none, the hike is drawn every `COVERED_DRAW_MS`.
   */
  cover(pace?: LoadPace): () => void;
  /**
   * Whether the frame at `now` (ms, the page's clock) draws: every one with no film over the hike, else one every
   * so often as the pace says. Asked once a frame: it is the pace's frame too.
   */
  due(now: number): boolean;
  /** The pipelines the draw may ask for off the page's thread, under a pace; undefined where nothing paces them. */
  asks(): number | undefined;
};

export function createCoveredDraw(): CoveredDraw {
  let covers = 0;
  let drawn = -Infinity;
  /** The paces of the covers that stand, the last made first asked. */
  const paces: LoadPace[] = [];
  const pace = (): LoadPace | undefined => paces[paces.length - 1];
  return {
    cover(mine) {
      covers++;
      if (mine !== undefined) paces.push(mine);
      let lifted = false;
      return () => {
        if (lifted) return;
        lifted = true;
        covers--;
        if (mine !== undefined) paces.splice(paces.indexOf(mine), 1);
      };
    },
    due(now) {
      if (covers === 0) return true;
      const by = pace();
      by?.frame(now);
      if (now - drawn < (by?.drawEveryMs() ?? COVERED_DRAW_MS)) return false;
      drawn = now;
      return true;
    },
    asks: () => (covers === 0 ? undefined : pace()?.asksPerDraw()),
  };
}
