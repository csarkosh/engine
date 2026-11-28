// The page-side half of the GPU inventory: code that runs INSIDE the page, before the page's own
// scripts, and wraps the WebGPU device's `createBuffer` and `createTexture` so that every buffer
// and texture the page makes is remembered with its size and the call stack that made it. A
// resource leaves the inventory when the page calls its `destroy()`. The browser's own tools see
// none of this: a buffer is memory in the GPU process, which a page's heap snapshot cannot count.
//
// `installTracker` is a plain function so the tests can run it against fakes; `TRACKER_SOURCE`
// is the same function as text, for `Page.addScriptToEvaluateOnNewDocument`. It must stay
// self-contained (it is stringified): no import, no outer name.

/**
 * Wraps `GPUDevice.prototype.createBuffer` and `createTexture` and puts `globalThis.__gpuReport()`
 * on the page, which returns the live inventory as a JSON string:
 *   { bufferBytes, textureBytes, count, unknownFormats: [format...], entries: [...] }
 * An entry is every live resource of one kind, label, format, size, usage and call stack, summed:
 *   { kind: "buffer" | "texture", label, format, dims, usage, bytes, count, stack: [{ fn, file, line }] }
 * A texture's bytes are the sum over its mip levels of
 *   (blocks across x blocks down) x bytes a block x layers x samples
 * where a block is one texel for an ordinary format and 4x4 or more for a block-compressed one
 * (a level is rounded up to whole blocks, as the GPU stores it). A 3D texture's depth halves with
 * each level; a 2D texture's layers do not. A format the table below does not know is counted at 4
 * bytes a texel and listed in `unknownFormats`, so the total is then a guess and says so.
 * A depth format's size is the browser's to choose, so the figure for those is an estimate.
 */
export function installTracker() {
  if (typeof GPUDevice === "undefined" || globalThis.__gpuReport) return;
  const live = new Map();

  // Format table: [block width, block height, bytes a block].
  const FORMATS = {};
  const plain = (bytes, names) => { for (const n of names.split(" ")) FORMATS[n] = [1, 1, bytes]; };
  plain(1, "r8unorm r8snorm r8uint r8sint stencil8");
  plain(2, "rg8unorm rg8snorm rg8uint rg8sint r16uint r16sint r16float depth16unorm");
  plain(4, "rgba8unorm rgba8unorm-srgb rgba8snorm rgba8uint rgba8sint bgra8unorm bgra8unorm-srgb rg16uint rg16sint rg16float r32uint r32sint r32float rgb10a2unorm rgb10a2uint rg11b10ufloat rgb9e5ufloat depth24plus depth32float");
  plain(8, "depth24plus-stencil8 rgba16uint rgba16sint rgba16float rg32uint rg32sint rg32float depth32float-stencil8");
  plain(16, "rgba32uint rgba32sint rgba32float");
  for (const n of "bc1-rgba-unorm bc1-rgba-unorm-srgb bc4-r-unorm bc4-r-snorm etc2-rgb8unorm etc2-rgb8unorm-srgb etc2-rgb8a1unorm etc2-rgb8a1unorm-srgb eac-r11unorm eac-r11snorm".split(" ")) FORMATS[n] = [4, 4, 8];
  for (const n of "bc2-rgba-unorm bc2-rgba-unorm-srgb bc3-rgba-unorm bc3-rgba-unorm-srgb bc5-rg-unorm bc5-rg-snorm bc6h-rgb-ufloat bc6h-rgb-float bc7-rgba-unorm bc7-rgba-unorm-srgb etc2-rgba8unorm etc2-rgba8unorm-srgb eac-rg11unorm eac-rg11snorm".split(" ")) FORMATS[n] = [4, 4, 16];
  for (const [w, h] of [[4, 4], [5, 4], [5, 5], [6, 5], [6, 6], [8, 5], [8, 6], [8, 8], [10, 5], [10, 6], [10, 8], [10, 10], [12, 10], [12, 12]]) {
    FORMATS[`astc-${w}x${h}-unorm`] = [w, h, 16];
    FORMATS[`astc-${w}x${h}-unorm-srgb`] = [w, h, 16];
  }
  const unknown = new Set();

  const textureBytes = (d) => {
    const s = d.size;
    const w = Array.isArray(s) ? s[0] : s.width;
    const h = (Array.isArray(s) ? s[1] : s.height) ?? 1;
    const l = (Array.isArray(s) ? s[2] : s.depthOrArrayLayers) ?? 1;
    let f = FORMATS[d.format];
    if (f === undefined) { unknown.add(String(d.format)); f = [1, 1, 4]; }
    const three = d.dimension === "3d";
    let total = 0;
    for (let m = 0; m < (d.mipLevelCount ?? 1); m++) {
      const lw = Math.max(1, w >> m), lh = Math.max(1, h >> m), ld = three ? Math.max(1, l >> m) : l;
      total += Math.ceil(lw / f[0]) * Math.ceil(lh / f[1]) * f[2] * ld;
    }
    return total * (d.sampleCount ?? 1);
  };

  // The call stack, innermost first, as { fn, file, line }. The file is the URL's path alone (no
  // host, no query), so the same build gives the same stack on a dev server and a deployed site.
  // The tracker's own two frames (this function and the wrapper that called it) are left out.
  const LINE = /^\s*at (?:(.*?) \()?(.*?):(\d+):(\d+)\)?$/;
  const stack = () => {
    const old = Error.stackTraceLimit;
    Error.stackTraceLimit = 24;
    const text = new Error().stack || "";
    Error.stackTraceLimit = old;
    const out = [];
    for (const line of text.split("\n").slice(3)) {
      const m = LINE.exec(line);
      if (m === null) continue;
      let file = m[2];
      try { file = decodeURIComponent(new URL(file).pathname).replace(/^\//, ""); } catch { /* not a URL: keep as is */ }
      if (file === "" || file === "<anonymous>") continue;
      out.push({ fn: m[1] ?? "", file, line: Number(m[3]) });
      if (out.length === 12) break;
    }
    return out;
  };

  const add = (obj, entry) => {
    live.set(obj, entry);
    const destroy = obj.destroy.bind(obj);
    obj.destroy = () => { live.delete(obj); destroy(); };
  };
  const createBuffer = GPUDevice.prototype.createBuffer;
  GPUDevice.prototype.createBuffer = function (d) {
    const b = createBuffer.call(this, d);
    add(b, { kind: "buffer", label: d.label || "", format: "", dims: "", usage: d.usage, bytes: d.size, stack: stack() });
    return b;
  };
  const createTexture = GPUDevice.prototype.createTexture;
  GPUDevice.prototype.createTexture = function (d) {
    const t = createTexture.call(this, d);
    const s = d.size;
    const w = Array.isArray(s) ? s[0] : s.width, h = (Array.isArray(s) ? s[1] : s.height) ?? 1, l = (Array.isArray(s) ? s[2] : s.depthOrArrayLayers) ?? 1;
    const mips = d.mipLevelCount ?? 1, samples = d.sampleCount ?? 1;
    const dims = `${w}x${h}${l > 1 ? "x" + l : ""}${d.dimension === "3d" ? " 3d" : ""}${mips > 1 ? " mips" + mips : ""}${samples > 1 ? " msaa" + samples : ""}`;
    add(t, { kind: "texture", label: d.label || "", format: String(d.format), dims, usage: d.usage, bytes: textureBytes(d), stack: stack() });
    return t;
  };

  globalThis.__gpuReport = () => {
    const by = new Map();
    let buffers = 0, textures = 0;
    for (const v of live.values()) {
      if (v.kind === "buffer") buffers += v.bytes; else textures += v.bytes;
      const key = JSON.stringify([v.kind, v.label, v.format, v.dims, v.usage, v.stack]);
      const e = by.get(key);
      if (e === undefined) by.set(key, { kind: v.kind, label: v.label, format: v.format, dims: v.dims, usage: v.usage, bytes: v.bytes, count: 1, stack: v.stack });
      else { e.bytes += v.bytes; e.count++; }
    }
    return JSON.stringify({ bufferBytes: buffers, textureBytes: textures, count: live.size, unknownFormats: [...unknown], entries: [...by.values()].sort((a, b) => b.bytes - a.bytes) });
  };
}

/** The tracker as a script for a page that has not started yet. */
export const TRACKER_SOURCE = `(${installTracker.toString()})();`;
