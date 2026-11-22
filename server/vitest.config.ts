import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // The settings file the tests that start a server with no origins of its own read: Day
    // Hike's, kept as a fixture because the engine holds no game's settings. A server run for
    // real finds its game's file from its working directory (`gameSettings.ts`).
    env: { GAME_SETTINGS: fileURLToPath(new URL("./test/fixtures/dayhike.game.json", import.meta.url)) },
  },
});
