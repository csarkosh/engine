import { describe, expect, it } from "vitest";
import { warmWorkerScripts } from "../../src/game/workerScripts.js";

describe("workers' scripts fetched ahead", () => {
  it("asks for each script once, however often and in whatever lists it is named", () => {
    const asked: string[] = [];
    const seen = new Set<string>();
    const ask = (url: string): Promise<void> => {
      asked.push(url);
      return Promise.resolve();
    };
    warmWorkerScripts(["/a.js", "/b.js"], ask, seen);
    warmWorkerScripts(["/b.js", "/c.js"], ask, seen);
    warmWorkerScripts(["/a.js", "/b.js", "/c.js"], ask, seen);
    expect(asked).toEqual(["/a.js", "/b.js", "/c.js"]);
  });

  it("leaves a script that could not be fetched alone: nothing is thrown, and it is not asked for again", async () => {
    const asked: string[] = [];
    const seen = new Set<string>();
    const ask = (url: string): Promise<void> => {
      asked.push(url);
      return Promise.reject(new Error("offline"));
    };
    expect(() => warmWorkerScripts(["/a.js"], ask, seen)).not.toThrow();
    await Promise.resolve();
    warmWorkerScripts(["/a.js"], ask, seen);
    expect(asked).toEqual(["/a.js"]);
  });
});
