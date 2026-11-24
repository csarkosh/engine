import { describe, expect, it } from "vitest";
import { heapLimitFields, memoryFields, readHeap } from "../../src/game/memoryRead.js";

/** What a session's rows say the page holds: the heap where the browser says, the device's bytes where they are counted, in megabytes. */
describe("a page's memory, for its rows", () => {
  const MB = 1048576;

  it("gives the heap and the device's bytes in whole megabytes", () => {
    expect(memoryFields({ usedJSHeapSize: 238.4 * MB, totalJSHeapSize: 264.6 * MB, jsHeapSizeLimit: 4192 * MB }, { buffers: 300, bufferBytes: 217 * MB, textures: 90, textureBytes: 341.2 * MB }))
      .toEqual({ heap: 238, heapTotal: 265, gpuBuf: 217, gpuTex: 341 });
  });

  it("leaves out what is not known: a browser with no reading of its heap, a device that is not counted", () => {
    expect(memoryFields(null, null)).toEqual({});
    expect(memoryFields(undefined, { buffers: 1, bufferBytes: 3 * MB, textures: 0, textureBytes: 0 })).toEqual({ gpuBuf: 3, gpuTex: 0 });
    expect(memoryFields({ usedJSHeapSize: 5 * MB }, null)).toEqual({ heap: 5 });
    expect(memoryFields({ usedJSHeapSize: Number.NaN, totalJSHeapSize: -1 }, null)).toEqual({});
  });

  it("gives the heap's limit once, for the session's own fields", () => {
    expect(heapLimitFields({ jsHeapSizeLimit: 4192 * MB })).toEqual({ heapLimit: 4192 });
    expect(heapLimitFields(null)).toEqual({});
    expect(heapLimitFields({})).toEqual({});
  });

  it("reads the browser's own record where there is one", () => {
    const memory = { usedJSHeapSize: 1, totalJSHeapSize: 2, jsHeapSizeLimit: 3 };
    expect(readHeap({ memory })).toBe(memory);
    expect(readHeap({})).toBeNull();
    expect(readHeap(undefined)).toBeNull();
  });
});
