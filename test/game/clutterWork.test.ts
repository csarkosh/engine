import { describe, expect, it } from "vitest";
import { CLUTTER_STRIP_INTS, clutterCellKey, type ClutterAnswer, type WorldClutterRequest } from "../../src/game/clutterWire.js";
import { CLUTTER_WORK_OUT, createClutterWork } from "../../src/game/clutterWork.js";
import { createWorldLink } from "../../src/game/worldLink.js";
import type { WorldPrepReply } from "../../src/game/worldWork.js";

type FakeWorker = {
  posted: WorldClutterRequest[];
  terminated: number;
  throwOnPost: boolean;
  onmessage: ((event: { data: WorldPrepReply }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
  postMessage(message: WorldClutterRequest): void;
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

const input = { seed: 7, variant: "v" };
/** One strip: class `cls`, cells x0..x1 by z0..z1. */
const strip = (cls: number, x0: number, x1: number, z0: number, z1: number): Int32Array => Int32Array.from([cls, x0, x1, z0, z1]);

function answerOf(set: number, instances: number, ms = 1): ClutterAnswer {
  return { set, cells: new Int32Array(instances * 3), values: new Float64Array(instances * 8), frames: new Float32Array(0), framed: new Uint8Array(instances), ms };
}

function make() {
  const worker = fakeWorker();
  const link = createWorldLink(worker as unknown as Worker);
  const work = createClutterWork(link, input);
  const answer = (set: number, instances = 0, ms = 1): void => {
    const id = (worker.posted[0] as WorldClutterRequest).id;
    worker.onmessage?.({ data: { id, kind: "clutterCells", ...answerOf(set, instances, ms) } as unknown as WorldPrepReply });
  };
  const failedReply = (id: number): void => worker.onmessage?.({ data: { id, kind: "failed", message: "no" } as WorldPrepReply });
  return { worker, link, work, answer, failedReply };
}

describe("createClutterWork", () => {
  it("posts a request with its fields and returns the set number, counting from 1", () => {
    const { worker, work } = make();
    const strips = strip(2, 0, 1, 0, 1);
    expect(work.ask(strips)).toBe(1);
    expect(worker.posted).toHaveLength(1);
    const request = worker.posted[0] as WorldClutterRequest;
    expect(request.kind).toBe("clutter");
    expect(request.seed).toBe(7);
    expect(request.variant).toBe("v");
    expect(request.set).toBe(1);
    expect(Array.from(request.strips)).toEqual([2, 0, 1, 0, 1]);
    expect(work.last).toBe(1);
    expect(work.through).toBe(0);
  });

  it("posts nothing for empty strips", () => {
    const { worker, work } = make();
    expect(work.ask(new Int32Array(0))).toBe(0);
    expect(worker.posted).toHaveLength(0);
    expect(work.last).toBe(0);
  });

  it("every cell of a request is asked from ask until filled, and no other", () => {
    const { work, answer } = make();
    const set = work.ask(strip(3, -1, 0, 5, 6));
    for (const cx of [-1, 0]) for (const cz of [5, 6]) expect(work.asked(clutterCellKey(3, cx, cz))).toBe(true);
    expect(work.asked(clutterCellKey(3, 1, 5))).toBe(false);
    expect(work.asked(clutterCellKey(2, 0, 5))).toBe(false);
    answer(set);
    expect(work.asked(clutterCellKey(3, 0, 5))).toBe(true);
    work.take();
    expect(work.asked(clutterCellKey(3, 0, 5))).toBe(true);
    work.filled(set);
    expect(work.asked(clutterCellKey(3, 0, 5))).toBe(false);
    expect(work.asked(clutterCellKey(3, -1, 6))).toBe(false);
  });

  it("a cell in two outstanding requests stays asked until both are filled", () => {
    const { work, answer } = make();
    const a = work.ask(strip(0, 0, 1, 0, 0));
    const b = work.ask(strip(0, 1, 2, 0, 0));
    answer(a);
    answer(b);
    work.filled(a);
    expect(work.asked(clutterCellKey(0, 1, 0))).toBe(true);
    expect(work.asked(clutterCellKey(0, 0, 0))).toBe(false);
    work.filled(a);
    expect(work.asked(clutterCellKey(0, 1, 0))).toBe(true);
    work.filled(b);
    expect(work.asked(clutterCellKey(0, 1, 0))).toBe(false);
    work.filled(99);
  });

  it("a third ask while two are unanswered posts nothing and is refused", () => {
    const { worker, work, answer } = make();
    expect(CLUTTER_WORK_OUT).toBe(2);
    expect(work.ask(strip(0, 0, 0, 0, 0))).toBe(1);
    expect(work.ask(strip(0, 1, 1, 0, 0))).toBe(2);
    expect(work.ask(strip(0, 2, 2, 0, 0))).toBe(0);
    expect(worker.posted).toHaveLength(2);
    expect(work.asked(clutterCellKey(0, 2, 0))).toBe(false);
    expect(work.record().refused).toBe(1);
    answer(1);
    expect(work.ask(strip(0, 2, 2, 0, 0))).toBe(3);
  });

  it("take hands over answers oldest first with the strips each was asked with", () => {
    const { work, answer } = make();
    const s1 = strip(0, 0, 0, 0, 0);
    const s2 = strip(1, 4, 5, 4, 5);
    work.ask(s1);
    work.ask(s2);
    expect(work.take()).toBeNull();
    answer(1, 1);
    answer(2, 2);
    const first = work.take();
    expect(first?.answer.set).toBe(1);
    expect(Array.from(first?.strips ?? [])).toEqual(Array.from(s1));
    const second = work.take();
    expect(second?.answer.set).toBe(2);
    expect(Array.from(second?.strips ?? [])).toEqual(Array.from(s2));
    expect(second?.strips.length).toBe(CLUTTER_STRIP_INTS);
    expect(work.take()).toBeNull();
  });

  it("through is the newest answered set, last the newest posted", () => {
    const { work, answer } = make();
    work.ask(strip(0, 0, 0, 0, 0));
    work.ask(strip(0, 1, 1, 0, 0));
    expect(work.last).toBe(2);
    expect(work.through).toBe(0);
    answer(1);
    expect(work.through).toBe(1);
    answer(2);
    expect(work.through).toBe(2);
  });

  it("reset forgets what was asked and drops the late answer of an older set, which still frees its place", () => {
    const { work, answer, worker } = make();
    work.ask(strip(0, 0, 0, 0, 0));
    work.ask(strip(0, 1, 1, 0, 0));
    answer(1, 1);
    work.reset();
    expect(work.asked(clutterCellKey(0, 0, 0))).toBe(false);
    expect(work.asked(clutterCellKey(0, 1, 0))).toBe(false);
    expect(work.take()).toBeNull();
    expect(work.through).toBe(work.last);
    // one set (2) is still out, so one more fits and then it is refused
    expect(work.ask(strip(0, 5, 5, 0, 0))).toBe(3);
    expect(work.ask(strip(0, 6, 6, 0, 0))).toBe(0);
    answer(2, 1);
    expect(work.take()).toBeNull();
    expect(work.through).toBe(2);
    expect(work.record().answered).toBe(2);
    // the dropped answer freed its place
    expect(work.ask(strip(0, 6, 6, 0, 0))).toBe(4);
    expect(worker.posted).toHaveLength(4);
    answer(3, 1);
    expect(work.take()?.answer.set).toBe(3);
    expect(work.through).toBe(3);
  });

  it("a failed reply fails the client for good", () => {
    const { worker, work, failedReply } = make();
    work.ask(strip(0, 0, 0, 0, 0));
    failedReply((worker.posted[0] as WorldClutterRequest).id);
    expect(work.failed).toBe(true);
    expect(work.asked(clutterCellKey(0, 0, 0))).toBe(false);
    expect(work.take()).toBeNull();
    expect(work.ask(strip(0, 1, 1, 0, 0))).toBe(0);
    expect(work.through).toBe(work.last);
    expect(work.record().failed).toBe(true);
  });

  it("a failed link fails the client, and a throwing post does too", () => {
    const a = make();
    a.work.ask(strip(0, 0, 0, 0, 0));
    a.worker.onerror?.({});
    expect(a.work.failed).toBe(true);
    expect(a.work.asked(clutterCellKey(0, 0, 0))).toBe(false);
    expect(a.work.through).toBe(a.work.last);
    expect(a.work.ask(strip(0, 1, 1, 0, 0))).toBe(0);
    const b = make();
    b.worker.throwOnPost = true;
    expect(b.work.ask(strip(0, 0, 0, 0, 0))).toBe(0);
    expect(b.work.failed).toBe(true);
    expect(b.work.asked(clutterCellKey(0, 0, 0))).toBe(false);
  });

  it("dispose unlistens and releases the hold once", () => {
    const { worker, work, answer } = make();
    work.ask(strip(0, 0, 0, 0, 0));
    work.dispose();
    work.dispose();
    expect(worker.terminated).toBe(1);
    expect(work.asked(clutterCellKey(0, 0, 0))).toBe(false);
    answer(1, 1);
    expect(work.take()).toBeNull();
  });

  it("record counts what was asked, received and refused", () => {
    const { work, answer } = make();
    work.ask(strip(0, 0, 1, 0, 2));
    work.ask(strip(0, 5, 5, 0, 0));
    work.ask(strip(0, 9, 9, 0, 0));
    answer(1, 3, 2);
    answer(2, 4, 5);
    expect(work.record()).toEqual({ asked: 2, cells: 7, instances: 7, answered: 2, workerMs: 7, out: 0, refused: 1, failed: false });
  });
});
