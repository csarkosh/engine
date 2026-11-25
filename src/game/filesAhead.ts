/**
 * A session's first files, asked for before the renderer that reads them
 * stands.
 *
 * A session's files are asked for by whatever reads them: the ground's
 * images by the renderer as it is made, the trees' models once it stands.
 * So between Play and the renderer standing the link carries the film alone,
 * while the world's worker finishes, the engine starts and the scene's code
 * loads: seconds, on a machine or a link that is slow, of the long wait a
 * first visit is (the files, tens of megabytes) not yet begun.
 *
 * `fetchFilesAhead` asks for a list of files at once, in order, each through
 * the same tries and the same turns behind the film as any file of the
 * session (`fetchRetry.ts`, `downloadTurns.ts`): a film that is short of data
 * holds them as it holds the rest. A reader that later wants one of them
 * takes it here (`fetchedOrAhead`), whole or still arriving, and fetches for
 * itself what was never asked for or failed. Each file is handed over once;
 * `dropFilesAhead` lets go of what no one took (a start that failed, a world
 * that reads none of them) and stops what is still arriving.
 *
 * What a file is held as is the browser's (a `Blob`): its bytes are not on
 * the page's heap. Nothing here knows which files a session reads: the game
 * names them (`PageGame.filesAhead`).
 */
import { fetchRetried } from "./fetchRetry.js";

/** Fetches a file whole; rejects with the signal's reason once it aborts. */
export type FetchWhole = (url: string, signal: AbortSignal) => Promise<Blob>;

const fetchWhole: FetchWhole = (url, signal) => fetchRetried(url, signal, (response) => response.blob());

export type FilesAhead = {
  /** Asks for each of `urls` not already asked for and still held, in order. */
  fetch(urls: readonly string[]): void;
  /** The file at `url`, as it arrives, handed over once; undefined where it is not held. */
  take(url: string): Promise<Blob> | undefined;
  /** Lets go of every file still held, and stops those still arriving. */
  drop(): void;
  /** How many files are held. */
  held(): number;
};

export function createFilesAhead(fetchOne: FetchWhole = fetchWhole): FilesAhead {
  let files = new Map<string, Promise<Blob>>();
  let stop = new AbortController();
  return {
    fetch(urls) {
      for (const url of urls) {
        if (files.has(url)) continue;
        const pending = fetchOne(url, stop.signal);
        // A file that fails says so to whoever takes it; unheard, it is no error of the page's.
        pending.catch(() => undefined);
        files.set(url, pending);
      }
    },
    take(url) {
      const pending = files.get(url);
      files.delete(url);
      return pending;
    },
    drop() {
      files = new Map();
      stop.abort(new DOMException("the files asked for ahead are no longer wanted", "AbortError"));
      stop = new AbortController();
    },
    held: () => files.size,
  };
}

/** The page's own: one session's files at a time. */
export const pageFilesAhead: FilesAhead = createFilesAhead();

/**
 * `fetchRetried`, taking the file from those asked for ahead where it is held: read from that copy, and fetched
 * afresh where the copy failed (a start cancelled, a link that dropped) and the reader still wants it.
 */
export async function fetchedOrAhead<T>(
  url: string,
  signal: AbortSignal | undefined,
  read: (response: Response) => Promise<T>,
  ahead: FilesAhead = pageFilesAhead,
  fetchSelf: typeof fetchRetried = fetchRetried,
): Promise<T> {
  const pending = ahead.take(url);
  if (pending !== undefined) {
    let blob: Blob | null = null;
    try {
      blob = await pending;
    } catch {
      blob = null;
    }
    signal?.throwIfAborted();
    if (blob !== null) return read(new Response(blob));
  }
  return fetchSelf(url, signal, read);
}
