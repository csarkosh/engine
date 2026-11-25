import { describe, expect, it } from "vitest";
import { createFilesAhead, fetchedOrAhead } from "../../src/game/filesAhead.js";

function rig() {
  const asked: string[] = [];
  const signals: AbortSignal[] = [];
  const settle = new Map<string, { resolve(blob: Blob): void; reject(error: unknown): void }>();
  const ahead = createFilesAhead((url, signal) => {
    asked.push(url);
    signals.push(signal);
    return new Promise<Blob>((resolve, reject) => {
      settle.set(url, { resolve, reject });
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
  const own: string[] = [];
  const fetchSelf = (async (url: string, _signal: AbortSignal | undefined, read: (response: Response) => Promise<unknown>) => {
    own.push(url);
    return read(new Response(`own ${url}`));
  }) as never;
  const text = (response: Response): Promise<string> => response.text();
  return { ahead, asked, signals, settle, own, fetchSelf, text };
}

describe("a session's first files, asked for ahead", () => {
  it("asks for each file once, in the order named, and hands each over once", async () => {
    const { ahead, asked, settle } = rig();
    ahead.fetch(["/a", "/b"]);
    ahead.fetch(["/b", "/c"]);
    expect(asked).toEqual(["/a", "/b", "/c"]);
    expect(ahead.held()).toBe(3);
    const taken = ahead.take("/a");
    expect(ahead.take("/a")).toBeUndefined();
    expect(ahead.held()).toBe(2);
    settle.get("/a")?.resolve(new Blob(["A"]));
    expect(await (await taken)?.text()).toBe("A");
    // A file handed over may be asked for again: it is a new fetch.
    ahead.fetch(["/a"]);
    expect(asked).toEqual(["/a", "/b", "/c", "/a"]);
  });

  it("gives a reader the copy asked for ahead, still arriving or whole, and no fetch of its own", async () => {
    const { ahead, settle, own, fetchSelf, text } = rig();
    ahead.fetch(["/a", "/b"]);
    settle.get("/b")?.resolve(new Blob(["B"]));
    const a = fetchedOrAhead("/a", undefined, text, ahead, fetchSelf);
    settle.get("/a")?.resolve(new Blob(["A"]));
    expect(await a).toBe("A");
    expect(await fetchedOrAhead("/b", undefined, text, ahead, fetchSelf)).toBe("B");
    expect(own).toEqual([]);
  });

  it("has a reader fetch for itself what was never asked for, and what failed ahead", async () => {
    const { ahead, settle, own, fetchSelf, text } = rig();
    expect(await fetchedOrAhead("/never", undefined, text, ahead, fetchSelf)).toBe("own /never");
    ahead.fetch(["/a"]);
    const a = fetchedOrAhead("/a", undefined, text, ahead, fetchSelf);
    settle.get("/a")?.reject(new Error("the link dropped"));
    expect(await a).toBe("own /a");
    expect(own).toEqual(["/never", "/a"]);
  });

  it("does not read for a reader that has gone", async () => {
    const { ahead, settle, own, fetchSelf, text } = rig();
    ahead.fetch(["/a"]);
    const gone = new AbortController();
    const a = fetchedOrAhead("/a", gone.signal, text, ahead, fetchSelf);
    gone.abort(new Error("torn down"));
    settle.get("/a")?.resolve(new Blob(["A"]));
    await expect(a).rejects.toThrow("torn down");
    expect(own).toEqual([]);
  });

  it("lets go of what no one took, stops what is still arriving, and starts afresh", async () => {
    const { ahead, asked, signals, own, fetchSelf, text } = rig();
    ahead.fetch(["/a", "/b"]);
    ahead.drop();
    expect(ahead.held()).toBe(0);
    expect(signals.map((s) => s.aborted)).toEqual([true, true]);
    expect(await fetchedOrAhead("/a", undefined, text, ahead, fetchSelf)).toBe("own /a");
    expect(own).toEqual(["/a"]);
    ahead.fetch(["/a"]);
    expect(asked).toEqual(["/a", "/b", "/a"]);
    expect(signals[2]?.aborted).toBe(false);
  });
});
