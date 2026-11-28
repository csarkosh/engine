import { describe, expect, it } from "vitest";
import type { RingSamples } from "../../src/game/clipmap.js";
import type { RingDrawn } from "../../src/game/ringBuild.js";
import type { RingSent, WorldRingsRequest } from "../../src/game/ringWire.js";
import { createRingWork } from "../../src/game/ringWork.js";
import { createWorldLink } from "../../src/game/worldLink.js";
import type { WorldPrepReply } from "../../src/game/worldWork.js";

type FakeWorker = {
  posted: WorldRingsRequest[];
  transfers: ArrayBuffer[][];
  terminated: number;
  onmessage: ((event: { data: WorldPrepReply }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
  postMessage(message: WorldRingsRequest, transfer?: ArrayBuffer[]): void;
  terminate(): void;
};

function fakeWorker(): FakeWorker {
  const worker: FakeWorker = {
    posted: [],
    transfers: [],
    terminated: 0,
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(message, transfer) {
      worker.posted.push(message);
      worker.transfers.push(transfer ?? []);
    },
    terminate() {
      worker.terminated += 1;
    },
  };
  return worker;
}

const sampleOf = (): RingSamples => {
  const a = (): Float32Array => new Float32Array(4);
  return { h: a(), hh: a(), dx: a(), dz: a(), colors: a(), weights: a(), weights2: a(), cover: a(), normals: a(), lift: a() } as unknown as RingSamples;
};
const samples = (): RingSamples[] => Array.from({ length: 7 }, sampleOf);
const sentOf = (): RingSent => ({ positions: new Float32Array(3), normals: new Float32Array(3), plugin: new Float32Array(3), indices: new Uint32Array(3) });
const drawnOf = (x: number): RingDrawn => ({ x, z: 0, fx: 0, fz: 0, cx: 0, cz: 0, kx: 0, kz: 0, kr: 0, kf: 0 });
const place = { camX: 1, camZ: 2, cover: null, drawn: [null, null, null, null, null, null, null] };

function make() {
  const worker = fakeWorker();
  const link = createWorldLink(worker as unknown as Worker);
  const work = createRingWork(link, { seed: 7, variant: "v" });
  const last = (): WorldRingsRequest => worker.posted[worker.posted.length - 1] as WorldRingsRequest;
  // The id is known from the first post; before it a client's own id is read off a throwaway ask.
  let id = -1;
  const reply = (r: Record<string, unknown>, withId?: number): void => {
    worker.onmessage?.({ data: { id: withId ?? id, ...r } as unknown as WorldPrepReply });
  };
  const ask = (withSamples = true): void => {
    work.ask(withSamples ? { ...place, samples: samples() } : place);
    id = last().id;
  };
  const ring = (set: number, level: number, x = level, ms = 1): RingSent => {
    const sent = sentOf();
    reply({ kind: "ring", set, level, drawn: drawnOf(x), ring: sent, ms });
    return sent;
  };
  const done = (set: number, ms = 1): void => reply({ kind: "ringsDone", set, ms });
  return { worker, link, work, last, reply, ask, ring, done };
}

describe("createRingWork", () => {
  it("is done, holding nothing and with no set out, before an ask", () => {
    const { work } = make();
    expect(work.done).toBe(true);
    expect(work.out).toBe(false);
    expect(work.holds).toBe(false);
    expect(work.failed).toBe(false);
    expect(work.take()).toBeUndefined();
  });

  it("the first ask carries the samples, transferred, and a second carries none", () => {
    const { worker, work, ask, done } = make();
    ask();
    const first = worker.posted[0] as WorldRingsRequest;
    expect(first.kind).toBe("rings");
    expect(first.seed).toBe(7);
    expect(first.variant).toBe("v");
    expect(first.set).toBe(1);
    expect(first.camX).toBe(1);
    expect(first.camZ).toBe(2);
    expect(first.samples).toHaveLength(7);
    expect(worker.transfers[0]).toHaveLength(70);
    expect(work.holds).toBe(true);
    done(1);
    ask(false);
    const second = worker.posted[1] as WorldRingsRequest;
    expect(second.set).toBe(2);
    expect(second.samples).toBeUndefined();
    expect(worker.transfers[1]).toHaveLength(0);
  });

  it("asks without samples while nothing is held throw, and post nothing", () => {
    const { worker, work } = make();
    expect(() => work.ask(place)).toThrow();
    expect(worker.posted).toHaveLength(0);
  });

  it("takes the rings in the order posted, once each", () => {
    const { work, ask, ring } = make();
    ask();
    const a = ring(1, 0);
    const b = ring(1, 1);
    expect(work.take()).toEqual({ level: 0, drawn: drawnOf(0), ring: a });
    expect(work.take()?.ring).toBe(b);
    expect(work.take()).toBeUndefined();
  });

  it("is done only after ringsDone of the set out, and rings are still taken after it", () => {
    const { work, ask, ring, done } = make();
    expect(work.done).toBe(true);
    ask();
    expect(work.done).toBe(false);
    expect(work.out).toBe(true);
    ring(1, 0);
    expect(work.done).toBe(false);
    done(1);
    expect(work.done).toBe(true);
    expect(work.out).toBe(false);
    expect(work.take()?.level).toBe(0);
    expect(work.take()).toBeUndefined();
  });

  it("an ask while a set is out throws", () => {
    const { worker, work, ask } = make();
    ask();
    expect(() => work.ask(place)).toThrow();
    expect(worker.posted).toHaveLength(1);
  });

  it("drops a ring of the set out that arrives after its ringsDone, and does not count it", () => {
    const { work, ask, ring, done } = make();
    ask();
    ring(1, 0);
    done(1);
    ring(1, 1);
    expect(work.take()?.level).toBe(0);
    expect(work.take()).toBeUndefined();
    expect(work.record().rings).toBe(1);
  });

  it("drops a reply whose set is not the set out", () => {
    const { work, ask, ring, done } = make();
    ask();
    done(1);
    ask(false);
    ring(1, 0);
    done(1, 50);
    expect(work.out).toBe(true);
    expect(work.take()).toBeUndefined();
    expect(work.record().workerMs).toBe(1);
    ring(2, 3);
    done(2);
    expect(work.take()?.level).toBe(3);
  });

  it("sends what was given back as spare with the next ask, transferred, once", () => {
    const { worker, work, ask, ring, done } = make();
    ask();
    const sent = ring(1, 0);
    const kept = ring(1, 1);
    done(1);
    const got = work.take();
    work.giveBack(got?.ring as RingSent);
    expect(work.take()?.ring).toBe(kept);
    ask(false);
    const second = worker.posted[1] as WorldRingsRequest;
    expect(second.spare).toEqual([sent]);
    // The very arrays given back, and the ring kept is not among them.
    const spare = second.spare?.[0] as RingSent;
    for (const name of ["positions", "normals", "plugin", "indices"] as const) {
      expect(spare[name], name).toBe(sent[name]);
      expect(spare[name], name).not.toBe(kept[name]);
    }
    expect(worker.transfers[1]).toHaveLength(4);
    const buffers = worker.transfers[1] as ArrayBuffer[];
    [sent.positions, sent.normals, sent.plugin, sent.indices].forEach((array, i) => expect(buffers[i]).toBe(array.buffer));
    done(2);
    ask(false);
    expect((worker.posted[2] as WorldRingsRequest).spare).toBeUndefined();
    expect(worker.transfers[2]).toHaveLength(0);
  });

  it("a stop posts a stop, drops untaken rings and late replies, and the next ask needs samples again", () => {
    const { worker, work, last, ask, ring, reply } = make();
    ask();
    ring(1, 0);
    work.stop();
    expect(last().stop).toBe(true);
    expect(last().set).toBe(2);
    expect(work.holds).toBe(false);
    expect(work.out).toBe(false);
    expect(work.done).toBe(true);
    expect(work.take()).toBeUndefined();
    ring(1, 1);
    reply({ kind: "ringsDone", set: 1, ms: 5 });
    expect(work.take()).toBeUndefined();
    expect(work.record().workerMs).toBe(0);
    expect(() => work.ask(place)).toThrow();
    work.ask({ ...place, samples: samples() });
    expect(worker.posted).toHaveLength(3);
    expect(last().set).toBe(3);
    expect(last().stop).toBeUndefined();
  });

  it("a stop with nothing held and no set out posts nothing", () => {
    const { worker, work } = make();
    work.stop();
    expect(worker.posted).toHaveLength(0);
  });

  it("a stop lets the queue of given-back rings go", () => {
    const { worker, work, ask, ring, done } = make();
    ask();
    ring(1, 0);
    done(1);
    work.giveBack(work.take()?.ring as RingSent);
    work.stop();
    expect((worker.posted[1] as WorldRingsRequest).spare).toBeUndefined();
    work.ask({ ...place, samples: samples() });
    expect((worker.posted[2] as WorldRingsRequest).spare).toBeUndefined();
  });

  it("a failed reply fails it for good: take gives nothing and ask posts nothing", () => {
    const { worker, work, ask, ring, reply } = make();
    ask();
    ring(1, 0);
    reply({ kind: "failed", message: "x" });
    expect(work.failed).toBe(true);
    expect(work.holds).toBe(false);
    expect(work.out).toBe(false);
    expect(work.done).toBe(true);
    expect(work.take()).toBeUndefined();
    expect(() => work.ask({ ...place, samples: samples() })).not.toThrow();
    work.giveBack(sentOf());
    work.stop();
    expect(worker.posted).toHaveLength(1);
  });

  it("the link failing fails it", () => {
    const { worker, work, ask } = make();
    ask();
    worker.onerror?.({});
    expect(work.failed).toBe(true);
    expect(work.done).toBe(true);
    expect(work.out).toBe(false);
  });

  it("a failed reply of another id does not fail it: the link routes replies by id, as the client relies on", () => {
    const { work, ask, reply } = make();
    ask();
    reply({ kind: "failed", message: "x" }, 999999);
    expect(work.failed).toBe(false);
    expect(work.out).toBe(true);
  });

  it("counts sets, rings and the worker's time in the record", () => {
    const { work, ask, ring, done } = make();
    ask();
    ring(1, 0);
    ring(1, 1);
    done(1, 7);
    ask(false);
    expect(work.record()).toEqual({ sets: 2, rings: 2, workerMs: 7, out: true, holds: true, failed: false });
    work.stop();
    expect(work.record().sets).toBe(2);
  });

  it("dispose stops, releases its hold on the link, and is safe twice", () => {
    const { worker, work, ask } = make();
    ask();
    work.dispose();
    expect(worker.posted[1]?.stop).toBe(true);
    expect(worker.terminated).toBe(1);
    expect(work.failed).toBe(true);
    work.dispose();
    expect(worker.terminated).toBe(1);
  });
});
