import { describe, expect, it } from "vitest";
import type { FacePatch } from "../../src/game/facePatches.js";
import { createPatchWork } from "../../src/game/patchWork.js";
import type { PatchCellAsk, WorldPatchesRequest, WorldPrepReply } from "../../src/game/worldWork.js";

type FakeWorker = {
  posted: WorldPatchesRequest[];
  terminated: number;
  throwOnPost: boolean;
  onmessage: ((event: { data: WorldPrepReply }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
  postMessage(message: WorldPatchesRequest): void;
  terminate(): void;
};

function fakeWorker(): FakeWorker {
  const worker: FakeWorker = {
    posted: [],
    terminated: 0,
    throwOnPost: false,
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(message) {
      if (worker.throwOnPost) throw new Error("cannot clone");
      worker.posted.push(message);
    },
    terminate() {
      worker.terminated += 1;
    },
  };
  return worker;
}

const cell = (ci: number): PatchCellAsk => ({ ci, cj: 0, spacing: 1, stitch: { n: 1, s: 1, e: 1, w: 1 } as unknown as PatchCellAsk["stitch"] });
const patchOf = (tag: number): FacePatch => ({ tag }) as unknown as FacePatch;
const input = { seed: 7, variant: "v" };

function make() {
  const worker = fakeWorker();
  const work = createPatchWork(worker as unknown as Worker, input);
  const id = (worker.posted[0]?.id as number | undefined) ?? -1;
  const reply = (r: Record<string, unknown>, withId?: number): void => {
    const lastId = worker.posted.length > 0 ? (worker.posted[worker.posted.length - 1] as WorldPatchesRequest).id : id;
    worker.onmessage?.({ data: { id: withId ?? lastId, ...r } as unknown as WorldPrepReply });
  };
  const patch = (set: number, index: number, p: FacePatch | null, ms = 1): void => reply({ kind: "patch", set, index, patch: p, ms });
  return { worker, work, reply, patch };
}

describe("createPatchWork", () => {
  it("a cell asked is taken once it arrives, and only once", () => {
    const { work, patch } = make();
    work.ask([cell(1)], [10]);
    expect(work.take(10)).toBeUndefined();
    const p = patchOf(1);
    patch(1, 0, p);
    expect(work.take(10)).toBe(p);
    expect(work.take(10)).toBeUndefined();
  });

  it("a null patch arrives as null, not undefined", () => {
    const { work, patch } = make();
    work.ask([cell(1)], [10]);
    patch(1, 0, null);
    expect(work.take(10)).toBeNull();
    expect(work.take(10)).toBeUndefined();
  });

  it("replies in any order land under their own keys", () => {
    const { work, patch } = make();
    work.ask([cell(1), cell(2), cell(3)], [10, 20, 30]);
    const [a, b, c] = [patchOf(1), patchOf(2), patchOf(3)];
    patch(1, 2, c);
    patch(1, 0, a);
    patch(1, 1, b);
    expect(work.take(20)).toBe(b);
    expect(work.take(30)).toBe(c);
    expect(work.take(10)).toBe(a);
  });

  it("posts one request per ask with the client's id, seed, variant and a counting set", () => {
    const { worker, work } = make();
    work.ask([cell(1)], [1]);
    work.ask([cell(2)], [2]);
    work.clear();
    expect(worker.posted.map((r) => r.set)).toEqual([1, 2, 3]);
    expect(new Set(worker.posted.map((r) => r.id)).size).toBe(1);
    expect(worker.posted[0]).toMatchObject({ kind: "patches", seed: 7, variant: "v" });
    expect(worker.posted[2]).toMatchObject({ cells: [], seed: 7, variant: "v" });
  });

  it("throws on keys and cells of different lengths", () => {
    const { work, worker } = make();
    expect(() => work.ask([cell(1), cell(2)], [1])).toThrow();
    expect(worker.posted).toHaveLength(0);
  });

  it("a newer set posts every cell whose key has not arrived, even one an older set asked", () => {
    const { worker, work, patch } = make();
    work.ask([cell(1), cell(2), cell(3)], [1, 2, 3]);
    work.ask([cell(2), cell(9)], [2, 9]);
    expect(worker.posted[1]?.cells).toEqual([cell(2), cell(9)]);
    const [a, b, c] = [patchOf(1), patchOf(2), patchOf(3)];
    patch(1, 0, a);
    patch(1, 1, b);
    patch(1, 2, c);
    expect(work.take(1)).toBeUndefined();
    expect(work.take(2)).toBe(b);
    expect(work.take(3)).toBeUndefined();
  });

  it("a second reply for a key already taken or arrived is dropped, the first winning", () => {
    const { work, patch } = make();
    work.ask([cell(1), cell(2), cell(3)], [1, 2, 3]);
    work.ask([cell(2), cell(9)], [2, 9]);
    const first = patchOf(1);
    patch(1, 1, first);
    expect(work.take(2)).toBe(first);
    patch(2, 0, patchOf(2));
    expect(work.take(2)).toBeUndefined();
    expect(work.record().arrived).toBe(1);
    // arrived but not yet taken: the second does not replace the first
    patch(2, 1, patchOf(3));
    patch(2, 1, patchOf(4));
    expect(work.take(9)).toEqual(patchOf(3));
    expect(work.record().arrived).toBe(2);
  });

  it("a key taken stays taken, and a later ask that names it asks it again", () => {
    const { worker, work, patch } = make();
    work.ask([cell(1)], [1]);
    patch(1, 0, patchOf(1));
    expect(work.take(1)).toEqual(patchOf(1));
    work.ask([cell(1)], [1]);
    expect(worker.posted[1]?.cells).toHaveLength(1);
    patch(2, 0, patchOf(5));
    expect(work.take(1)).toEqual(patchOf(5));
  });

  it("a key the newest set names that has arrived is kept and not asked again", () => {
    const { worker, work, patch } = make();
    work.ask([cell(1), cell(2)], [1, 2]);
    patch(1, 0, patchOf(1));
    work.ask([cell(1), cell(2), cell(3)], [1, 2, 3]);
    expect(worker.posted[1]?.cells).toEqual([cell(2), cell(3)]);
    expect(work.take(1)).toEqual(patchOf(1));
  });

  it("what arrived under a key the newer set does not name is dropped at the ask", () => {
    const { work, patch } = make();
    work.ask([cell(1), cell(2)], [1, 2]);
    patch(1, 0, patchOf(1));
    patch(1, 1, patchOf(2));
    work.ask([cell(2)], [2]);
    expect(work.take(1)).toBeUndefined();
    expect(work.take(2)).toEqual(patchOf(2));
  });

  it("a failed reply fails for good", () => {
    const { worker, work, reply, patch } = make();
    work.ask([cell(1), cell(2)], [1, 2]);
    patch(1, 0, patchOf(1));
    reply({ kind: "failed", message: "boom" });
    expect(work.failed).toBe(true);
    expect(work.take(1)).toBeUndefined();
    patch(1, 1, patchOf(2));
    expect(work.take(2)).toBeUndefined();
    work.ask([cell(3)], [3]);
    work.clear();
    expect(worker.posted).toHaveLength(1);
    expect(worker.terminated).toBe(0);
    expect(work.failed).toBe(true);
  });

  it("an error event, a message that cannot be read, and a post that throws fail for good", () => {
    for (const how of ["error", "messageerror", "post"] as const) {
      const { worker, work } = make();
      work.ask([cell(1)], [1]);
      if (how === "error") worker.onerror?.({});
      else if (how === "messageerror") worker.onmessageerror?.({});
      else {
        worker.throwOnPost = true;
        work.ask([cell(2)], [2]);
      }
      expect(work.failed).toBe(true);
      expect(work.take(1)).toBeUndefined();
      expect(work.take(2)).toBeUndefined();
      expect(worker.terminated).toBe(0);
    }
  });

  it("clear forgets and posts an empty set; a reply of the set before is never taken", () => {
    const { worker, work, patch } = make();
    work.ask([cell(1), cell(2)], [1, 2]);
    patch(1, 0, patchOf(1));
    work.clear();
    expect(worker.posted[1]).toMatchObject({ set: 2, cells: [], seed: 7, variant: "v" });
    expect(work.take(1)).toBeUndefined();
    patch(1, 1, patchOf(2));
    expect(work.take(2)).toBeUndefined();
    expect(work.failed).toBe(false);
  });

  it("dispose ends the worker once, fails, and takes the listeners off", () => {
    const { worker, work } = make();
    work.ask([cell(1)], [1]);
    work.dispose();
    work.dispose();
    expect(worker.terminated).toBe(1);
    expect(work.failed).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
    work.ask([cell(2)], [2]);
    expect(worker.posted).toHaveLength(1);
  });

  it("record counts", () => {
    const { work, patch, reply } = make();
    expect(work.record()).toEqual({ asked: 0, arrived: 0, waiting: 0, workerMs: 0, replies: 0, sets: 0, failed: false });
    work.ask([cell(1), cell(2), cell(3)], [1, 2, 3]);
    expect(work.record()).toMatchObject({ asked: 3, waiting: 3, sets: 1 });
    patch(1, 0, patchOf(1), 5);
    patch(1, 1, patchOf(2), 7);
    expect(work.record()).toMatchObject({ asked: 3, arrived: 2, waiting: 1, workerMs: 12, sets: 1 });
    work.ask([cell(3)], [3]);
    patch(1, 2, patchOf(3), 4); // older set's reply, kept: its key is named
    patch(2, 0, patchOf(3), 3); // duplicate: dropped, but its ms count
    expect(work.record()).toEqual({ asked: 4, arrived: 3, waiting: 0, workerMs: 19, replies: 4, sets: 2, failed: false });
    reply({ kind: "failed", message: "x" });
    expect(work.record().failed).toBe(true);
  });

  it("counts every patch reply of its own, kept or dropped, so workerMs / replies is the worker's time a cell", () => {
    const { work, patch, reply } = make();
    work.ask([cell(1), cell(2)], [1, 2]);
    patch(1, 0, patchOf(1), 6);
    // A duplicate, dropped: the worker built it all the same.
    patch(1, 0, patchOf(1), 2);
    // Another client's: not this one's.
    reply({ kind: "patch", set: 1, index: 1, patch: patchOf(2), ms: 50 }, 999999);
    reply({ kind: "patchesDone", set: 1 });
    expect(work.record()).toMatchObject({ arrived: 1, replies: 2, workerMs: 8 });
    expect(work.record().workerMs / work.record().replies).toBe(4);
  });

  it("a reply with another id is ignored", () => {
    const { work, reply, patch } = make();
    work.ask([cell(1)], [1]);
    reply({ kind: "patch", set: 1, index: 0, patch: patchOf(1), ms: 9 }, 999999);
    reply({ kind: "failed", message: "not ours" }, 999999);
    expect(work.take(1)).toBeUndefined();
    expect(work.failed).toBe(false);
    expect(work.record().workerMs).toBe(0);
    patch(1, 0, patchOf(1));
    expect(work.take(1)).toEqual(patchOf(1));
  });

  it("a patchesDone ends nothing the client holds", () => {
    const { work, reply, patch } = make();
    work.ask([cell(1)], [1]);
    patch(1, 0, patchOf(1));
    reply({ kind: "patchesDone", set: 1 });
    expect(work.take(1)).toEqual(patchOf(1));
    expect(work.failed).toBe(false);
  });
});
