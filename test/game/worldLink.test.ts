import { describe, expect, it, vi } from "vitest";
import { createWorldLink } from "../../src/game/worldLink.js";
import type { WorldPrepReply } from "../../src/game/worldWork.js";

type FakeWorker = {
  posted: unknown[];
  terminated: number;
  throwOnPost: boolean;
  onmessage: ((event: { data: WorldPrepReply }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
  postMessage(message: unknown): void;
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

const make = () => {
  const worker = fakeWorker();
  const link = createWorldLink(worker as unknown as Worker);
  const send = (reply: Record<string, unknown>): void => worker.onmessage?.({ data: reply as unknown as WorldPrepReply });
  return { worker, link, send };
};

describe("createWorldLink", () => {
  it("gives ids no other link has", () => {
    const a = make().link;
    const b = make().link;
    const ids = [a.nextId(), b.nextId(), a.nextId(), b.nextId()];
    expect(new Set(ids).size).toBe(4);
  });

  it("delivers a reply to the listener of its id only, until unlisten", () => {
    const { link, send } = make();
    const one: WorldPrepReply[] = [];
    const two: WorldPrepReply[] = [];
    link.listen(1, (r) => one.push(r));
    link.listen(2, (r) => two.push(r));
    send({ id: 1, kind: "done" });
    send({ id: 3, kind: "done" });
    expect(one).toHaveLength(1);
    expect(two).toHaveLength(0);
    link.unlisten(1);
    send({ id: 1, kind: "done" });
    expect(one).toHaveLength(1);
  });

  it("a failed reply reaches its id's listener alone and leaves the link working", () => {
    const { worker, link, send } = make();
    const one: WorldPrepReply[] = [];
    const two: WorldPrepReply[] = [];
    link.listen(1, (r) => one.push(r));
    link.listen(2, (r) => two.push(r));
    let failures = 0;
    link.onFail(() => (failures += 1));
    send({ id: 1, kind: "failed", message: "boom" });
    expect(one).toHaveLength(1);
    expect(two).toHaveLength(0);
    expect(link.failed).toBe(false);
    expect(failures).toBe(0);
    send({ id: 2, kind: "done" });
    expect(two).toHaveLength(1);
    expect(link.post({ a: 1 })).toBe(true);
    expect(worker.posted).toEqual([{ a: 1 }]);
  });

  it("an error event, a message that cannot be read and a post that throws each fail the link once and stop posts", () => {
    for (const how of ["error", "messageerror", "post"] as const) {
      const { worker, link, send } = make();
      let first = 0;
      let second = 0;
      link.onFail(() => (first += 1));
      link.onFail(() => (second += 1));
      const heard: WorldPrepReply[] = [];
      link.listen(1, (r) => heard.push(r));
      if (how === "error") worker.onerror?.({});
      else if (how === "messageerror") worker.onmessageerror?.({});
      else {
        worker.throwOnPost = true;
        expect(link.post({ a: 1 })).toBe(false);
      }
      worker.onerror?.({});
      expect(link.failed).toBe(true);
      expect([first, second]).toEqual([1, 1]);
      worker.throwOnPost = false;
      expect(link.post({ b: 2 })).toBe(false);
      expect(worker.posted).toEqual([]);
      send({ id: 1, kind: "done" });
      expect(heard).toHaveLength(0);
      expect(worker.terminated).toBe(0);
    }
  });

  it("onFail on a link already failed is called at once", () => {
    const { worker, link } = make();
    worker.onerror?.({});
    let called = 0;
    link.onFail(() => (called += 1));
    expect(called).toBe(1);
  });

  it("ends the worker once, when the last of two holds is released", () => {
    const { worker, link } = make();
    const a = link.hold();
    const b = link.hold();
    a();
    a();
    expect(worker.terminated).toBe(0);
    expect(link.failed).toBe(false);
    b();
    expect(worker.terminated).toBe(1);
    expect(link.failed).toBe(true);
    b();
    expect(worker.terminated).toBe(1);
  });

  it("dispose ends the worker once however often it is called, fails the link and hears nothing after", () => {
    const { worker, link, send } = make();
    const release = link.hold();
    let failures = 0;
    link.onFail(() => (failures += 1));
    const heard: WorldPrepReply[] = [];
    link.listen(1, (r) => heard.push(r));
    link.dispose();
    link.dispose();
    release();
    expect(worker.terminated).toBe(1);
    expect(failures).toBe(1);
    expect(link.failed).toBe(true);
    expect(worker.onmessage).toBeNull();
    send({ id: 1, kind: "done" });
    expect(heard).toHaveLength(0);
    expect(link.post({})).toBe(false);
  });

  it("an onFail callback that throws does not keep the others from being told", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { worker, link } = make();
      let second = 0;
      link.onFail(() => {
        throw new Error("listener");
      });
      link.onFail(() => (second += 1));
      expect(() => worker.onerror?.({})).not.toThrow();
      expect(second).toBe(1);
      expect(link.failed).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("dispose ends the worker once and does not throw when an onFail callback throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { worker, link } = make();
      link.onFail(() => {
        throw new Error("listener");
      });
      expect(() => link.dispose()).not.toThrow();
      link.dispose();
      expect(worker.terminated).toBe(1);
      expect(link.failed).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
