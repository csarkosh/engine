import { describe, expect, it } from "vitest";
import { CODE_AHEAD_ID, codeAheadUrls, preloadCode } from "../../src/game/codeAhead.js";

const page = (text: string | null) => ({ getElementById: (id: string) => (id === CODE_AHEAD_ID && text !== null ? ({ textContent: text } as HTMLElement) : null) });

describe("a game's code, loaded ahead", () => {
  it("reads the list the build wrote into the page", () => {
    expect(codeAheadUrls(page('["/game/assets/a.js","/game/assets/b.js"]'))).toEqual(["/game/assets/a.js", "/game/assets/b.js"]);
  });

  it("reads no list, an empty one and one that is no list of addresses as nothing to load", () => {
    expect(codeAheadUrls(page(null))).toEqual([]);
    expect(codeAheadUrls(page(""))).toEqual([]);
    expect(codeAheadUrls(page("not json"))).toEqual([]);
    expect(codeAheadUrls(page('{"a":1}'))).toEqual([]);
    expect(codeAheadUrls(page('["/a.js", 3, "", null]'))).toEqual(["/a.js"]);
  });

  it("asks the browser for each file once, as a module preload", () => {
    const links: { rel: string; crossOrigin: string | null; href: string }[] = [];
    const doc = {
      createElement: () => ({ rel: "", crossOrigin: null, href: "" }),
      head: { appendChild: (link: { rel: string; crossOrigin: string | null; href: string }) => (links.push(link), link) },
    } as unknown as Pick<Document, "createElement" | "head">;
    const seen = new Set<string>();
    preloadCode(["/a.js", "/b.js"], doc, seen);
    preloadCode(["/b.js", "/c.js"], doc, seen);
    expect(links).toEqual([
      { rel: "modulepreload", crossOrigin: "", href: "/a.js" },
      { rel: "modulepreload", crossOrigin: "", href: "/b.js" },
      { rel: "modulepreload", crossOrigin: "", href: "/c.js" },
    ]);
  });
});
