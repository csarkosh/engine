// Test root for tools/: the engine's scripts (the gate, the frame budget, the previews, the
// comparison, the kernel's build, the Vite preset). Plain Node ESM with no TypeScript and no DOM, so
// it needs none of the engine's own config. Started from the engine's root (`npm run test:tools`).
// The scripts read a game's files (stills, views) from the directory they are run in; their tests
// read small fixtures of their own instead.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/test/**/*.test.mjs'],
  },
});
