import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TRACKER_SOURCE, installTracker } from '../lib/track.mjs';

/** A stand-in for the browser's device: `createBuffer` and `createTexture` hand back objects with `destroy`. */
class FakeDevice {
  createBuffer() {
    return { destroy() {} };
  }
  createTexture() {
    return { destroy() {} };
  }
}

let device;
const report = () => JSON.parse(globalThis.__gpuReport());

beforeEach(() => {
  globalThis.GPUDevice = FakeDevice;
  installTracker();
  device = new FakeDevice();
});
afterEach(() => {
  delete globalThis.GPUDevice;
  delete globalThis.__gpuReport;
});

/** The bytes one more texture adds to the inventory. */
const texture = (descriptor) => {
  const before = report().textureBytes;
  device.createTexture({ label: 't', usage: 4, ...descriptor });
  return report().textureBytes - before;
};

describe('the inventory the page keeps', () => {
  it('counts a buffer by its size and keeps its label and the call stack', () => {
    device.createBuffer({ label: 'verts', size: 4096, usage: 32 });
    const r = report();
    expect(r).toMatchObject({ bufferBytes: 4096, textureBytes: 0, count: 1, unknownFormats: [] });
    expect(r.entries[0]).toMatchObject({ kind: 'buffer', label: 'verts', bytes: 4096, count: 1, usage: 32 });
    expect(r.entries[0].stack[0].file).toMatch(/track\.test\.mjs$/);
    expect(typeof r.entries[0].stack[0].line).toBe('number');
  });
  it('forgets a resource when the page destroys it', () => {
    const a = device.createBuffer({ size: 100 });
    device.createBuffer({ size: 50 });
    a.destroy();
    expect(report()).toMatchObject({ bufferBytes: 50, count: 1 });
  });
  it('sums resources of the same kind, label, size and stack into one entry', () => {
    for (let i = 0; i < 3; i++) device.createBuffer({ label: 'b', size: 10 });
    expect(report().entries).toHaveLength(1);
    expect(report().entries[0]).toMatchObject({ bytes: 30, count: 3 });
  });
  it('keeps resources of different sizes apart in a texture and lists the largest first', () => {
    device.createTexture({ size: [4, 4], format: 'rgba8unorm' });
    device.createTexture({ size: [16, 16], format: 'rgba8unorm' });
    expect(report().entries.map((e) => e.bytes)).toEqual([1024, 64]);
  });
  it('does nothing without WebGPU, and does not wrap twice', () => {
    delete globalThis.GPUDevice;
    delete globalThis.__gpuReport;
    installTracker();
    expect(globalThis.__gpuReport).toBeUndefined();
    globalThis.GPUDevice = FakeDevice;
    installTracker();
    const once = FakeDevice.prototype.createBuffer;
    installTracker();
    expect(FakeDevice.prototype.createBuffer).toBe(once);
  });
  it('runs as text too, which is how the page gets it', () => {
    expect(TRACKER_SOURCE.startsWith('(function installTracker()')).toBe(true);
    expect(TRACKER_SOURCE.endsWith('})();')).toBe(true);
  });
});

describe('what a texture is counted at', () => {
  it('is texels times bytes a texel for a plain format', () => {
    expect(texture({ size: [8, 4], format: 'rgba8unorm' })).toBe(8 * 4 * 4);
  });
  it('adds each mip level, halving down to one texel', () => {
    // 4x4 + 2x2 + 1x1 texels at 4 bytes
    expect(texture({ size: [4, 4], format: 'rgba8unorm', mipLevelCount: 3 })).toBe((16 + 4 + 1) * 4);
  });
  it('multiplies by the layers of a 2D array, which do not shrink with the levels', () => {
    expect(texture({ size: { width: 4, height: 4, depthOrArrayLayers: 6 }, format: 'r8unorm', mipLevelCount: 2 })).toBe((16 + 4) * 6);
  });
  it('shrinks the depth of a 3D texture with the levels', () => {
    expect(texture({ size: [4, 4, 4], dimension: '3d', format: 'r8unorm', mipLevelCount: 3 })).toBe(64 + 2 * 2 * 2 + 1);
  });
  it('multiplies by the samples of a multisampled texture', () => {
    expect(texture({ size: [10, 10], format: 'bgra8unorm', sampleCount: 4 })).toBe(10 * 10 * 4 * 4);
  });
  it('counts a block-compressed format in whole blocks, rounding each level up', () => {
    // 8-byte 4x4 blocks: 8x8 is 2x2 blocks, 4x4 is 1, 2x2 and 1x1 are one block each
    expect(texture({ size: [8, 8], format: 'bc1-rgba-unorm', mipLevelCount: 4 })).toBe((4 + 1 + 1 + 1) * 8);
    expect(texture({ size: [6, 6], format: 'astc-6x6-unorm' })).toBe(16);
    expect(texture({ size: [5, 5], format: 'bc7-rgba-unorm' })).toBe(4 * 16);
  });
  it('counts a format it does not know at 4 bytes a texel and says which', () => {
    expect(texture({ size: [2, 2], format: 'made-up-format' })).toBe(16);
    expect(report().unknownFormats).toEqual(['made-up-format']);
  });
  it('writes the size of a texture into its entry', () => {
    device.createTexture({ label: 'x', size: { width: 4, height: 2, depthOrArrayLayers: 3 }, format: 'rgba16float', mipLevelCount: 2, sampleCount: 1 });
    expect(report().entries[0]).toMatchObject({ format: 'rgba16float', dims: '4x2x3 mips2', label: 'x' });
  });
});
