/**
 * Which of the page's world workers each kind of work is on. A worker serves every kind it is asked, so this table
 * alone decides who does what; a game that runs one worker has every kind on it.
 *
 * This module imports types only.
 */
import type { WorldLink } from "./worldLink.js";

export type WorldKind = "rings" | "clutter" | "patches";

/**
 * The index of the link each kind is on, where there are two: the rings and the rock faces on the first, as with one
 * worker, and the clutter alone on the second. Measured against the other split (the clutter with the rings, the rock
 * faces alone): a clutter request that waits behind a set of rings is answered too late to be of use at speed, and the
 * page then looks the cells up itself.
 */
export const WORLD_ROUTES: Readonly<Record<WorldKind, 0 | 1>> = { rings: 0, clutter: 1, patches: 0 };

/** What the measurement mode reads out of the session's workers (`window.__worldWork()`). */
export type WorldWorkRead = {
  /** The links made that have not failed. */
  workers: number;
  /** The index of the link each kind's client is on, -1 where it has none (its link is null: it is built on the page's thread). */
  routes: Record<WorldKind, number>;
  /** The second worker's preparation, or null where none was started. */
  second: { preparedMs: number | null; failed: boolean } | null;
};

/** The link the table names for `kind`, or the first where there is one worker; null where that link is null. */
export function linkFor(kind: WorldKind, links: readonly (WorldLink | null)[]): WorldLink | null {
  if (links.length <= 1) return links[0] ?? null;
  return links[WORLD_ROUTES[kind]] ?? null;
}
