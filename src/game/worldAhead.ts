/**
 * The next session's world, made before Play is pressed.
 *
 * A session's world is made off the page's thread by the world's worker
 * (`worldPrep.ts`), and the session's build waits for it: nothing of the
 * session is fetched, compiled or built until it is in. Started at Play, that
 * wait was the first two to seven seconds of every start (a laptop, a rented
 * rig), with the film playing and nothing loading under it. But the world
 * depends on two things only, its seed and its terrain, and the seed is the
 * token Play gives the session, which can be made any time.
 *
 * So while the landing page stands, the page makes the token the next Play
 * will use and starts that world's worker; where the tier a start would be
 * given is known with no check (`tierAhead`), the session's first scene at
 * that tier is asked of the worker too. A player who looks at the landing
 * page for a few seconds presses Play on a world already made, and the build
 * begins as soon as the renderer's canvas is up.
 *
 * `take` hands the world over to the session at that token, once, when its
 * address still names the same seed and terrain; any other session (a lobby
 * followed, a link opened, an address edited) ends what was made ahead and
 * starts its own, as it always did. Nothing here is the worker's or the
 * shell's own: both are handed in, so the rule is tested with fakes.
 */
import type { PreparedScene } from "./preparedScene.js";
import type { QualityTier } from "./quality.js";
import type { WorldPrep } from "./worldPrep.js";

/** What a world is made from (`worldInputs.ts`). */
export type WorldMadeFrom = { seed: number; variant: string };

/** A world made ahead, as the session it was made for takes it. */
export type WorldTaken = {
  prep: WorldPrep;
  /** The session's first scene: the tier it was asked at, and its promise; null where none was asked. */
  first: { tier: QualityTier; made: Promise<PreparedScene | null> } | null;
};

export type WorldAhead = {
  /**
   * Makes a world for the session the next Play starts, at the address's query `search`, and asks its first scene
   * at `tier` where one is given. Again with nothing changed does nothing. Where the tier or the query has changed,
   * what was made is ended and made again for the same token: the world the page already holds is not made twice
   * (`worldPrep.ts`), only what differs.
   */
  warm(search: string, tier: QualityTier | null): void;
  /** The token Play starts its session at: the one a world is being made for, else a new one. */
  token(): string;
  /**
   * The world made ahead for the session at `token`, whose world is made from `from`: handed over once, and null
   * where none was made for it. What was made for any other session is ended.
   */
  take(token: string, from: WorldMadeFrom): WorldTaken | null;
  /**
   * Resolves once the world being made now has been (its worker ended, however it ended), and at once where none is
   * being made: what should not share the machine with the worker waits for this.
   */
  whenMade(): Promise<void>;
  /** Ends whatever is being made. */
  dispose(): void;
};

export function createWorldAhead(deps: {
  /** A new session's token. */
  mint(): string;
  /** What the world of the session at `token` is made from, at the address's query `search`. */
  from(token: string, search: string): WorldMadeFrom;
  /** Starts the world's worker for it (`startWorldPrep`). */
  start(from: WorldMadeFrom): WorldPrep;
}): WorldAhead {
  let held: { token: string; search: string; from: WorldMadeFrom; tier: QualityTier | null; taken: WorldTaken } | null = null;

  function make(token: string, search: string, tier: QualityTier | null): void {
    const from = deps.from(token, search);
    const prep = deps.start(from);
    held = { token, search, from, tier, taken: { prep, first: tier === null ? null : { tier, made: prep.scene(tier) } } };
  }

  function end(): void {
    held?.taken.prep.dispose();
    held = null;
  }

  return {
    warm(search, tier) {
      if (held !== null && held.search === search && held.tier === tier) return;
      const token = held?.token ?? deps.mint();
      end();
      make(token, search, tier);
    },
    token: () => held?.token ?? deps.mint(),
    take(token, from) {
      if (held === null) return null;
      if (held.token !== token || held.from.seed !== from.seed || held.from.variant !== from.variant) {
        end();
        return null;
      }
      const { taken } = held;
      held = null;
      return taken;
    },
    whenMade: () => (held === null ? Promise.resolve() : held.taken.prep.ready.then(() => undefined, () => undefined)),
    dispose: end,
  };
}
