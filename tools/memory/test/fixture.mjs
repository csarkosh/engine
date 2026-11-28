// A small made-up inventory: what `check.mjs` writes, with a stack of each kind the grouping must tell apart.
const frame = (fn, file, line = 1) => ({ fn, file, line });

const lib = [frame('createBuffer', 'node_modules/.vite/deps/renderer.js', 10), frame('makeMesh', 'node_modules/.vite/deps/renderer.js', 20)];

export const entries = [
  // Made by the game's own code, below the renderer's frames.
  { kind: 'buffer', label: 'vertices', format: '', dims: '', usage: 32, bytes: 4 * 1048576, count: 4, stack: [...lib, frame('buildTown', '@fs/Users/dev/game/src/town/parts.ts', 55), frame('boot', 'src/main.ts', 3)] },
  // Made by the engine, installed as a package: counts as the application's own.
  { kind: 'buffer', label: '', format: '', dims: '', usage: 32, bytes: 2 * 1048576, count: 2, stack: [...lib, frame('makeForest', 'node_modules/@csarkosh/engine/src/game/forest.ts', 9)] },
  { kind: 'texture', label: 'scene', format: 'rgba16float', dims: '1280x720', usage: 20, bytes: 7 * 1048576, count: 1, stack: [...lib, frame('setup', 'src/render/post.ts', 40)] },
  { kind: 'texture', label: '', format: 'bc7-rgba-unorm', dims: '1024x1024 mips11', usage: 4, bytes: 3 * 1048576, count: 3, stack: [...lib, frame('loadModel', 'src/models/load.ts', 8)] },
  // Only library frames: the nearest named frame stands for it.
  { kind: 'texture', label: '', format: 'r8unorm', dims: '16x16', usage: 4, bytes: 1048576, count: 1, stack: lib },
];

export const inventory = {
  schema: 1,
  label: 'fixture',
  gpu: { available: true, bufferBytes: 6 * 1048576, textureBytes: 11 * 1048576, count: 11, unknownFormats: [], entries },
  processes: [
    { pid: 1, type: 'browser', rssMB: 100, footprintMB: 90 },
    { pid: 2, type: 'renderer', rssMB: 500, footprintMB: 400 },
    { pid: 3, type: 'gpu-process', rssMB: 700, footprintMB: 600 },
  ],
  heaps: [{ type: 'page', url: 'x', usedMB: 80, totalMB: 100, embedderMB: 0, backingMB: 0 }],
};
