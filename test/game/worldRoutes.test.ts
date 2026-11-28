import { describe, expect, it } from "vitest";
import { WORLD_ROUTES, linkFor } from "../../src/game/worldRoutes.js";
import type { WorldLink } from "../../src/game/worldLink.js";

const link = (name: string): WorldLink => ({ name }) as unknown as WorldLink;

describe("the routes of the world's work", () => {
  it("names the link each kind is on", () => {
    expect(WORLD_ROUTES).toEqual({ rings: 0, clutter: 1, patches: 0 });
  });

  it("gives each kind the link the table names when there are two", () => {
    const first = link("first");
    const second = link("second");
    expect(linkFor("rings", [first, second])).toBe(first);
    expect(linkFor("clutter", [first, second])).toBe(second);
    expect(linkFor("patches", [first, second])).toBe(first);
  });

  it("gives every kind the one link when there is one worker", () => {
    const first = link("first");
    for (const kind of ["rings", "clutter", "patches"] as const) expect(linkFor(kind, [first])).toBe(first);
    expect(linkFor("clutter", [first, null])).toBeNull();
  });

  it("gives null where the named link is null, and where there is none", () => {
    const first = link("first");
    expect(linkFor("clutter", [first, null])).toBeNull();
    expect(linkFor("rings", [null, link("second")])).toBeNull();
    expect(linkFor("rings", [])).toBeNull();
    expect(linkFor("patches", [null])).toBeNull();
  });
});

describe("the links of a game that asked for two workers", () => {
  it("leaves a kind without a link where the second worker could not be made", () => {
    const first = link("first");
    expect(linkFor("clutter", [first, null])).toBeNull();
    expect(linkFor("rings", [first, null])).toBe(first);
    expect(linkFor("patches", [first, null])).toBe(first);
  });
});
