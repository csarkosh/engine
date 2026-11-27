import { describe, expect, it } from "vitest";
import type { PreparedScene } from "../../src/game/preparedScene.js";
import type { QualityTier } from "../../src/game/quality.js";
import { createWorldAhead, type WorldMadeFrom } from "../../src/game/worldAhead.js";
import type { WorldPrep, WorldPrepOutcome } from "../../src/game/worldPrep.js";

/** Workers that record what they were started and asked for. */
function fakes() {
  const started: { from: WorldMadeFrom; scenes: QualityTier[]; disposed: number; prep: WorldPrep }[] = [];
  let minted = 0;
  const ahead = createWorldAhead({
    mint: () => `token-${++minted}`,
    // The seed is the token's number, unless the address's query names one.
    from: (token, search) => ({ seed: search.includes("seed=") ? Number(search.split("seed=")[1]) : Number(token.split("-")[1]), variant: search.includes("montane") ? "montane" : "olympic" }),
    start(from) {
      const record = {
        from,
        scenes: [] as QualityTier[],
        disposed: 0,
        prep: {
          ready: new Promise<WorldPrepOutcome>(() => undefined),
          scene(tier: QualityTier) {
            record.scenes.push(tier);
            return Promise.resolve<PreparedScene | null>(null);
          },
          handOver: () => null,
          dispose() {
            record.disposed++;
          },
        } satisfies WorldPrep,
      };
      started.push(record);
      return record.prep;
    },
  });
  return { ahead, started, minted: () => minted };
}

describe("the next session's world, made before Play", () => {
  it("makes a token, starts that world's worker and asks its first scene at the tier given", () => {
    const { ahead, started } = fakes();
    ahead.warm("", "medium");
    expect(started).toHaveLength(1);
    expect(started[0]!.from).toEqual({ seed: 1, variant: "olympic" });
    expect(started[0]!.scenes).toEqual(["medium"]);
    // Play starts its session at that token, and the session takes the world, once.
    expect(ahead.token()).toBe("token-1");
    const taken = ahead.take("token-1", { seed: 1, variant: "olympic" });
    expect(taken?.prep).toBe(started[0]!.prep);
    expect(taken?.first?.tier).toBe("medium");
    expect(started[0]!.disposed).toBe(0);
    expect(ahead.take("token-1", { seed: 1, variant: "olympic" })).toBeNull();
  });

  it("asks for no scene where the tier is a check's to decide", () => {
    const { ahead, started } = fakes();
    ahead.warm("", null);
    expect(started[0]!.scenes).toEqual([]);
    expect(ahead.take("token-1", { seed: 1, variant: "olympic" })?.first).toBeNull();
  });

  it("does nothing when asked again with nothing changed", () => {
    const { ahead, started, minted } = fakes();
    ahead.warm("", "low");
    ahead.warm("", "low");
    ahead.warm("", "low");
    expect(started).toHaveLength(1);
    expect(minted()).toBe(1);
  });

  it("makes it again for the same token where the tier or the address's query has changed", () => {
    const { ahead, started, minted } = fakes();
    ahead.warm("", "low");
    ahead.warm("", "high");
    expect(started).toHaveLength(2);
    expect(started[0]!.disposed).toBe(1);
    expect(started[1]!.from).toEqual({ seed: 1, variant: "olympic" });
    expect(started[1]!.scenes).toEqual(["high"]);
    ahead.warm("?cmd=terrain montane", "high");
    expect(started[1]!.disposed).toBe(1);
    expect(started[2]!.from).toEqual({ seed: 1, variant: "montane" });
    expect(minted()).toBe(1);
    expect(ahead.token()).toBe("token-1");
  });

  it("gives Play a new token where no world is being made", () => {
    const { ahead, started } = fakes();
    expect(ahead.token()).toBe("token-1");
    expect(ahead.token()).toBe("token-2");
    expect(started).toHaveLength(0);
    expect(ahead.take("token-2", { seed: 2, variant: "olympic" })).toBeNull();
  });

  it("ends what was made for another session: another token, or the same token on another seed or terrain", () => {
    for (const [token, from] of [
      ["token-9", { seed: 9, variant: "olympic" }],
      ["token-1", { seed: 77, variant: "olympic" }],
      ["token-1", { seed: 1, variant: "montane" }],
    ] as const) {
      const { ahead, started } = fakes();
      ahead.warm("", "medium");
      expect(ahead.take(token, from), token).toBeNull();
      expect(started[0]!.disposed, token).toBe(1);
      // Nothing is held after: the next Play has a new token, and a world can be made ahead again.
      expect(ahead.token()).toBe("token-2");
      ahead.warm("", "medium");
      expect(started).toHaveLength(2);
    }
  });

  it("ends the worker when disposed, and a world taken is no longer its own to end", () => {
    const { ahead, started } = fakes();
    ahead.warm("", "medium");
    ahead.dispose();
    ahead.dispose();
    expect(started[0]!.disposed).toBe(1);
    ahead.warm("", "medium");
    ahead.take("token-2", { seed: 2, variant: "olympic" });
    ahead.dispose();
    expect(started[1]!.disposed).toBe(0);
  });

  it("says when the world being made has been, for what should not share the machine with its worker", async () => {
    const ends: { resolve(outcome: WorldPrepOutcome): void; reject(error: unknown): void }[] = [];
    const ahead = createWorldAhead({
      mint: () => "token",
      from: () => ({ seed: 1, variant: "olympic" }),
      start: () => ({
        ready: new Promise<WorldPrepOutcome>((resolve, reject) => ends.push({ resolve, reject })),
        scene: () => Promise.resolve<PreparedScene | null>(null),
        handOver: () => null,
        dispose: () => undefined,
      }),
    });
    // Nothing is being made: there is nothing to wait for.
    await ahead.whenMade();
    ahead.warm("", null);
    let made = false;
    void ahead.whenMade().then(() => {
      made = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(made).toBe(false);
    ends[0]!.resolve({ why: "done" } as WorldPrepOutcome);
    await ahead.whenMade();
    expect(made).toBe(true);
    // A worker that fails has ended too.
    ahead.warm("?seed=2", null);
    const second = ahead.whenMade();
    ends[1]!.reject(new Error("the worker broke"));
    await expect(second).resolves.toBeUndefined();
  });
});
