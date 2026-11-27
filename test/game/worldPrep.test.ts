import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreparedScene } from "../../src/game/preparedScene.js";
import { startWorldPrep } from "../../src/game/worldPrep.js";
import type { WorldPrepReply } from "../../src/game/worldWork.js";

/** A worker that records what it is sent and how often it was ended; the test answers for it. */
type FakeWorker = {
  posted: { id: number; kind?: string }[];
  terminated: number;
  onmessage: ((event: { data: WorldPrepReply }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
  postMessage(message: { id: number; kind?: string }): void;
  terminate(): void;
};

function fakeWorker(): FakeWorker {
  const worker: FakeWorker = {
    posted: [],
    terminated: 0,
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(message) {
      worker.posted.push(message);
    },
    terminate() {
      worker.terminated += 1;
    },
  };
  return worker;
}

/** A terrain no registry knows: it prepares nothing, so the worker is asked for the pass hash alone. */
const input = { seed: 7, variant: "fake-terrain" };
const LIMIT = 1000;

/** Lets the promises the prep chains run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function make() {
  const worker = fakeWorker();
  const prep = startWorldPrep(input, () => worker as unknown as Worker, { now: () => 0, timeoutMs: LIMIT });
  const reply = (r: Record<string, unknown>): void => worker.onmessage?.({ data: r as unknown as WorldPrepReply });
  const last = (): { id: number; kind?: string } => worker.posted[worker.posted.length - 1]!;
  /** The world's request answered: done. */
  const worldDone = async (): Promise<void> => {
    reply({ id: worker.posted[0]!.id, kind: "done" });
    await flush();
  };
  /** The scene's request, once posted, answered with a scene for `tier` and then done. */
  const sceneMade = async (tier: "low" | "medium" | "high" = "medium"): Promise<void> => {
    await flush();
    const { id } = last();
    reply({ id, kind: "scene", scene: { seed: input.seed, variant: input.variant, tier } as unknown as PreparedScene });
    reply({ id, kind: "done" });
    await flush();
  };
  return { worker, prep, reply, last, worldDone, sceneMade };
}

describe("startWorldPrep: the worker's life", () => {
  beforeEach(() => {
    vi.stubGlobal("Worker", class {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("a worker that made the scene is not ended by the settle", async () => {
    const { worker, prep, worldDone, sceneMade } = make();
    await worldDone();
    const asked = prep.scene("medium");
    await sceneMade();
    expect((await asked)?.tier).toBe("medium");
    expect(worker.posted.map((m) => m.kind)).toEqual([undefined, "scene"]);
    expect(worker.terminated).toBe(0);
    // Its listeners stay on it: it is still the wrapper's until handed over or disposed.
    expect(worker.onmessage).not.toBeNull();
  });

  it("handOver gives the worker, with no listener of the wrapper's on it, once", async () => {
    const { worker, prep, worldDone, sceneMade } = make();
    await worldDone();
    const asked = prep.scene("medium");
    await sceneMade();
    await asked;
    expect(prep.handOver()).toBe(worker);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
    expect(prep.handOver()).toBeNull();
    expect(worker.terminated).toBe(0);
    // The scene asked before the hand-over is still the one given.
    expect(prep.scene("medium")).toBe(asked);
  });

  it("dispose after handOver does not end the worker", async () => {
    const { worker, prep, worldDone, sceneMade } = make();
    await worldDone();
    const asked = prep.scene("medium");
    await sceneMade();
    await asked;
    expect(prep.handOver()).toBe(worker);
    prep.dispose();
    prep.dispose();
    expect(worker.terminated).toBe(0);
    expect(worker.onmessage).toBeNull();
  });

  it("dispose without handOver ends the worker that made the scene, once", async () => {
    const { worker, prep, worldDone, sceneMade } = make();
    await worldDone();
    const asked = prep.scene("medium");
    await sceneMade();
    await asked;
    prep.dispose();
    prep.dispose();
    expect(worker.terminated).toBe(1);
    expect(worker.onmessage).toBeNull();
    expect(prep.handOver()).toBeNull();
  });

  it("handOver is null while the world's request is out, and the worker is kept", async () => {
    const { worker, prep, worldDone } = make();
    expect(prep.handOver()).toBeNull();
    expect(worker.onmessage).not.toBeNull();
    await worldDone();
    expect((await prep.ready).why).toBe("done");
    expect(prep.handOver()).toBe(worker);
  });

  it("handOver is null while the scene's request is out, asked or posted, and the request is still answered", async () => {
    const { worker, prep, reply, last, worldDone } = make();
    await worldDone();
    const asked = prep.scene("medium");
    // Asked, not yet posted.
    expect(prep.handOver()).toBeNull();
    await flush();
    expect(last().kind).toBe("scene");
    // Posted, not yet answered.
    expect(prep.handOver()).toBeNull();
    const { id } = last();
    reply({ id, kind: "scene", scene: { seed: input.seed, variant: input.variant, tier: "medium" } as unknown as PreparedScene });
    expect((await asked)?.tier).toBe("medium");
    await flush();
    expect(worker.terminated).toBe(0);
    expect(prep.handOver()).toBe(worker);
  });

  it("handOver is null after a world that failed, and the worker was ended", async () => {
    const { worker, prep, reply } = make();
    reply({ id: worker.posted[0]!.id, kind: "failed" });
    expect((await prep.ready).why).toBe("failed");
    expect(worker.terminated).toBe(1);
    expect(prep.handOver()).toBeNull();
  });

  it("handOver is null after a world that timed out, and the worker was ended", async () => {
    vi.useFakeTimers();
    const { worker, prep } = make();
    vi.advanceTimersByTime(LIMIT);
    expect((await prep.ready).why).toBe("timeout");
    expect(worker.terminated).toBe(1);
    expect(prep.handOver()).toBeNull();
  });

  it("handOver is null after dispose, and the worker was ended", async () => {
    const { worker, prep, worldDone } = make();
    await worldDone();
    prep.dispose();
    expect(worker.terminated).toBe(1);
    expect(prep.handOver()).toBeNull();
  });

  it("a prep that finished the world and was asked for no scene hands its worker over", async () => {
    const { worker, prep, worldDone } = make();
    await worldDone();
    expect(prep.handOver()).toBe(worker);
    expect(worker.onmessage).toBeNull();
    prep.dispose();
    expect(worker.terminated).toBe(0);
    // A scene asked after the hand-over has no worker to ask: none, and nothing posted.
    expect(await prep.scene("medium")).toBeNull();
    expect(worker.posted).toHaveLength(1);
  });

  it("a scene request that fails ends the worker", async () => {
    const { worker, prep, reply, last, worldDone } = make();
    await worldDone();
    const asked = prep.scene("medium");
    await flush();
    reply({ id: last().id, kind: "failed" });
    expect(await asked).toBeNull();
    expect(worker.terminated).toBe(1);
    expect(prep.handOver()).toBeNull();
  });

  it("a scene request done with no scene of its own ends the worker", async () => {
    const { worker, prep, reply, last, worldDone } = make();
    await worldDone();
    const asked = prep.scene("medium");
    await flush();
    // A scene of another tier is not this request's.
    reply({ id: last().id, kind: "scene", scene: { seed: input.seed, variant: input.variant, tier: "high" } as unknown as PreparedScene });
    reply({ id: last().id, kind: "done" });
    expect(await asked).toBeNull();
    expect(worker.terminated).toBe(1);
    expect(prep.handOver()).toBeNull();
  });

  it("a scene request that runs out of time ends the worker", async () => {
    vi.useFakeTimers();
    const { worker, prep, worldDone } = make();
    await worldDone();
    const asked = prep.scene("medium");
    await flush();
    expect(worker.posted.map((m) => m.kind)).toEqual([undefined, "scene"]);
    vi.advanceTimersByTime(LIMIT);
    expect(await asked).toBeNull();
    expect(worker.terminated).toBe(1);
    expect(prep.handOver()).toBeNull();
  });

  it("a scene that came clears its time limit: the worker is not ended when the limit would have run out", async () => {
    vi.useFakeTimers();
    const { worker, prep, worldDone, sceneMade } = make();
    await worldDone();
    const asked = prep.scene("medium");
    await sceneMade();
    expect(await asked).not.toBeNull();
    vi.advanceTimersByTime(LIMIT * 2);
    expect(worker.terminated).toBe(0);
    expect(prep.handOver()).toBe(worker);
  });

  it("an error from the worker after its scene ends it", async () => {
    const { worker, prep, worldDone, sceneMade } = make();
    await worldDone();
    const asked = prep.scene("medium");
    await sceneMade();
    await asked;
    worker.onerror?.(new Error("gone"));
    expect(worker.terminated).toBe(1);
    expect(prep.handOver()).toBeNull();
  });
});
