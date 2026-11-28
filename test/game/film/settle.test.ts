import { describe, expect, it } from "vitest";
import { SETTLE_FRAMES, settle } from "../../../src/game/film/settle.js";

describe("settle", () => {
  it("draws until the world has been quiet for SETTLE_FRAMES draws", async () => {
    let calls = 0;
    const draw = async () => {
      calls += 1;
    };
    const busy = () => calls <= 5;
    expect(await settle(draw, busy, 1000)).toEqual({ frames: 5 + SETTLE_FRAMES, settled: true });
  });

  it("gives up at maxFrames when the world never settles", async () => {
    let calls = 0;
    const result = await settle(async () => void (calls += 1), () => true, 50);
    expect(result).toEqual({ frames: 50, settled: false });
    expect(calls).toBe(50);
  });
});
