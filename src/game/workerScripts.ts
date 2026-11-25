/**
 * The scripts of a page's workers, fetched ahead at a high priority.
 *
 * A browser asks for a worker's script at its lowest priority, under a film's
 * (low) and under every file a session fetches (high), and a server that
 * honours priorities sends a lower request nothing while a higher one has
 * data to send. So over a real link a worker started beside a film or during
 * a session's downloads does not start: its script, a few kilobytes, waits
 * for megabytes. Measured on a preview over a home link: the world's worker
 * waited 3 to 10 s for its script where Play was pressed two seconds after
 * the page loaded, with the start waiting for it; the wind sea's waited 27 to
 * 48 s, until the models were in, and the far trees' 4 to 8 s, and the world
 * was not ready until they had run. On a local server none of it shows.
 *
 * So each script is fetched once, ahead of its worker, by the page itself at
 * a high priority: the files are named by their content and kept by the
 * browser's cache for good, and the worker's own request, made later at the
 * lowest priority, is answered from the cache with nothing asked of the
 * link. Where the cache keeps nothing (a development server) the fetch is a
 * waste of a few kilobytes and the worker starts as it did.
 *
 * `warmWorkerScripts` is the rule: once a script, a failure left alone (the
 * worker's own request says what went wrong). The scripts' addresses are the
 * bundler's (`engineWorkerScripts.ts`, and a game's own in its `PageGame`).
 */

/** Fetches a script into the browser's cache at a high priority; resolves when it is in or has failed. */
export type AskScript = (url: string) => Promise<void>;

const askAhead: AskScript = (url) =>
  fetch(url, { priority: "high" })
    // Read to its end: a cache keeps a response once its body is in.
    .then((response) => response.arrayBuffer())
    .then(
      () => undefined,
      () => undefined,
    );

const asked = new Set<string>();

/** Fetches each of `urls` ahead of its worker, once a page however often it is asked. */
export function warmWorkerScripts(urls: readonly string[], ask: AskScript = askAhead, seen: Set<string> = asked): void {
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    void ask(url).catch(() => undefined);
  }
}
