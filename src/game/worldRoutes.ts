/**
 * Which of the page's world workers each kind of work is on. A worker serves every kind it is asked, so this table
 * alone decides who does what; a game that runs one worker has every kind on it.
 *
 * This module imports types only.
 */
import type { WorldLink } from "./worldLink.js";

export type WorldKind = "rings" | "clutter" | "patches";

/** The index of the link each kind is on, where there are two. */
export const WORLD_ROUTES: Readonly<Record<WorldKind, 0 | 1>> = { rings: 0, clutter: 0, patches: 1 };

/** What the measurement mode reads out of the session's workers (`window.__worldWork()`). */
export type WorldWorkRead = {
  /** The links made. */
  workers: number;
  /** The index of the link each kind is on. */
  routes: Record<WorldKind, number>;
  /** The second worker's preparation, or null where none was started. */
  second: { preparedMs: number | null; failed: boolean } | null;
};

/** The link the table names for `kind`, or the first where there is one worker; null where that link is null. */
export function linkFor(kind: WorldKind, links: readonly (WorldLink | null)[]): WorldLink | null {
  if (links.length <= 1) return links[0] ?? null;
  return links[WORLD_ROUTES[kind]] ?? null;
}
