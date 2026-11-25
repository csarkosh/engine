/**
 * A game's code, loaded ahead of the session that runs it.
 *
 * A build splits the game into a few hundred small files, and most are
 * asked for only where they are first used: the renderer's when a scene is
 * registered, a model reader's when the first model is in. Each names the
 * next, so over a real link they arrive one after another, a round trip
 * each: on a preview over a home link the scene's own dozen took 1.6 s,
 * after the ground's images were in, and nothing of the session was asked
 * for meanwhile.
 *
 * So the build lists its files of code in the page (the preset's
 * `engineCodeAhead`, a block of JSON under `CODE_AHEAD_ID`), and once the
 * landing page has loaded the page asks the browser to load them all
 * (`<link rel="modulepreload">`): fetched at once, compiled, run by no one
 * until they are imported. All of a game's lazy code is a few hundred
 * kilobytes, a hundredth of the film the same page loads. A page with no
 * list (a development server, an older build) preloads nothing and loads its
 * code as it did.
 */

/** The id of the page's list of its files of code, as the build wrote it. */
export const CODE_AHEAD_ID = "engine-code-ahead";

/** The addresses the page lists: none where there is no list, or it is not a list of addresses. */
export function codeAheadUrls(doc: Pick<Document, "getElementById">): string[] {
  const text = doc.getElementById(CODE_AHEAD_ID)?.textContent;
  if (text === null || text === undefined || text === "") return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.filter((url): url is string => typeof url === "string" && url !== "") : [];
  } catch {
    return [];
  }
}

const preloaded = new Set<string>();

/** Asks the browser to load each of `urls` as a module, once a page however often it is asked. */
export function preloadCode(urls: readonly string[], doc: Pick<Document, "createElement" | "head"> = document, seen: Set<string> = preloaded): void {
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    const link = doc.createElement("link");
    link.rel = "modulepreload";
    // As the build's own preloads are asked for, so the import that follows finds this copy.
    link.crossOrigin = "";
    link.href = url;
    doc.head.appendChild(link);
  }
}
