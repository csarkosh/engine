import { describe, expect, it } from "vitest";
import { startSecondWorld } from "../../src/game/worldSecond.js";
import type { WorldPrepReply } from "../../src/game/worldWork.js";

type FakeWorker = {
  posted: Record<string, unknown>[];
  terminated: number;
  onmessage: ((event: { data: WorldPrepReply }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
  postMessage(message: Record<string, unknown>): void;
  terminate(): void;
};

function fakeWorker(): FakeWorker {
  const worker: FakeWorker = {
    posted: [], terminated: 0, onmessage: null, onerror: null, onmessageerror: null,
    postMessage(message) { worker.posted.push(message); },
    terminate() { worker.terminated += 1; },
  };
  return worker;
}

const from = { seed: 7, variant: "fake-terrain" };

describe("the second world worker", () => {
  it("posts one quiet prepare for the world's seed and variant", () => {
    const worker = fakeWorker();
    const second = startSecondWorld(() => worker as unknown as Worker, from);
    expect(second).not.toBeNull();
    expect(worker.posted).toHaveLength(1);
    expect(worker.posted[0]).toMatchObject({ seed: 7, variant: "fake-terrain", quiet: true });
    expect(typeof worker.posted[0]?.id).toBe("number");
    expect(worker.posted[0]).not.toHaveProperty("kind");
  });

  it("records when done came, and nothing before", () => {
    const worker = fakeWorker();
    let clock = 100;
    const second = startSecondWorld(() => worker as unknown as Worker, from, () => clock)!;
    expect(second.record()).toEqual({ preparedMs: null, failed: false });
    clock = 350;
    worker.onmessage?.({ data: { id: worker.posted[0]!.id as number, kind: "done" } });
    expect(second.record()).toEqual({ preparedMs: 250, failed: false });
    expect(second.link.failed).toBe(false);
  });

  it("delivers a request posted before done, and does not hold it back", () => {
    const worker = fakeWorker();
    const second = startSecondWorld(() => worker as unknown as Worker, from)!;
    expect(second.link.post({ id: second.link.nextId(), kind: "patches" })).toBe(true);
    expect(worker.posted).toHaveLength(2);
    expect(worker.posted[1]).toMatchObject({ kind: "patches" });
  });

  it("fails the link when the prepare fails", () => {
    const worker = fakeWorker();
    const second = startSecondWorld(() => worker as unknown as Worker, from)!;
    worker.onmessage?.({ data: { id: worker.posted[0]!.id as number, kind: "failed", message: "no" } });
    expect(second.link.failed).toBe(true);
    expect(second.record()).toEqual({ preparedMs: null, failed: true });
    expect(worker.terminated).toBe(1);
  });

  it("ends the worker with the link", () => {
    const worker = fakeWorker();
    const second = startSecondWorld(() => worker as unknown as Worker, from)!;
    second.link.dispose();
    expect(worker.terminated).toBe(1);
    expect(second.record().failed).toBe(true);
  });

  it("is null where no worker can be made", () => {
    expect(startSecondWorld(() => { throw new Error("no worker"); }, from)).toBeNull();
  });
});
