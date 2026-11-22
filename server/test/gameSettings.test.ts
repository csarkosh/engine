import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGameSettings, parseGameSettings, queriesDirOf } from "../src/gameSettings.js";

/** Day Hike's settings, kept as a fixture: the engine holds no game's own file. */
const DAYHIKE = fileURLToPath(new URL("./fixtures/dayhike.game.json", import.meta.url));

const GOOD = {
  app: "game-dayhike",
  telemetryDataset: "dayhike_telemetry",
  telemetryBucket: "dayhike-telemetry",
  allowedOrigins: ["https://games.csarko.sh"],
};
const parse = (value: unknown) => parseGameSettings(JSON.stringify(value), "test.json");

describe("Day Hike's settings file", () => {
  const settings = loadGameSettings(DAYHIKE);
  it("names the app, dataset and bucket", () => {
    expect(settings.app).toBe("game-dayhike");
    expect(settings.telemetryDataset).toBe("dayhike_telemetry");
    expect(settings.telemetryBucket).toBe("dayhike-telemetry");
  });
  it("lists the origins, in order", () => {
    expect(settings.allowedOrigins).toEqual([
      "https://games.csarko.sh",
      "https://game.csarko.sh",
      "https://fps-csarko.web.app",
      "https://fps-csarko.firebaseapp.com",
      "http://localhost:5173",
      "https://localhost:5173",
      "https://admin.csarko.sh",
      "http://localhost:8788",
    ]);
  });
});

describe("parseGameSettings", () => {
  it("accepts a good file", () => {
    expect(parse(GOOD)).toEqual(GOOD);
  });
  for (const field of ["app", "telemetryDataset", "telemetryBucket", "allowedOrigins"]) {
    it(`refuses a file short of ${field}`, () => {
      const short: Record<string, unknown> = { ...GOOD };
      delete short[field];
      expect(() => parse(short)).toThrow(field);
    });
  }
  it("refuses an empty origins list", () => {
    expect(() => parse({ ...GOOD, allowedOrigins: [] })).toThrow("allowedOrigins");
  });
  it("refuses an origin that is not an origin", () => {
    expect(() => parse({ ...GOOD, allowedOrigins: ["https://games.csarko.sh/"] })).toThrow("allowedOrigins");
    expect(() => parse({ ...GOOD, allowedOrigins: ["games.csarko.sh"] })).toThrow("allowedOrigins");
  });
  it("refuses a bucket or dataset holding a character outside the set", () => {
    expect(() => parse({ ...GOOD, telemetryBucket: "day.hike" })).toThrow("telemetryBucket");
    expect(() => parse({ ...GOOD, telemetryBucket: "a`b" })).toThrow("telemetryBucket");
    expect(() => parse({ ...GOOD, telemetryDataset: "a b" })).toThrow("telemetryDataset");
  });
  it("keeps no queries field where the file has none", () => {
    expect("queries" in parse(GOOD)).toBe(false);
  });
  it("accepts a queries path relative to the file", () => {
    expect(parse({ ...GOOD, queries: "telemetry/queries" }).queries).toBe("telemetry/queries");
    expect(parse({ ...GOOD, queries: "../tools/telemetry/queries" }).queries).toBe("../tools/telemetry/queries");
  });
  it("refuses a queries path that is empty, not a string or absolute", () => {
    for (const queries of ["", 7, null, ["a"], "/etc/queries", "\\share\\queries", "C:\\queries"]) {
      expect(() => parse({ ...GOOD, queries }), JSON.stringify(queries)).toThrow("queries");
    }
  });
  it("refuses what is not an object, naming the file", () => {
    expect(() => parseGameSettings("[]", "x.json")).toThrow("x.json");
    expect(() => parseGameSettings("{", "x.json")).toThrow("x.json");
  });
});

describe("loadGameSettings", () => {
  const saved = process.env.GAME_SETTINGS;
  afterEach(() => {
    if (saved === undefined) delete process.env.GAME_SETTINGS;
    else process.env.GAME_SETTINGS = saved;
  });

  it("throws naming a path that is not there", () => {
    expect(() => loadGameSettings("/nonexistent/game.json")).toThrow("/nonexistent/game.json");
  });
  it("honours GAME_SETTINGS", () => {
    const file = join(mkdtempSync(join(tmpdir(), "game-settings-")), "other.json");
    writeFileSync(file, JSON.stringify({ ...GOOD, app: "other-game" }));
    process.env.GAME_SETTINGS = file;
    expect(loadGameSettings().app).toBe("other-game");
    process.env.GAME_SETTINGS = "/nonexistent/env.json";
    expect(() => loadGameSettings()).toThrow("/nonexistent/env.json");
  });
});

describe("where the settings file is found", () => {
  const saved = process.env.GAME_SETTINGS;
  const game = (app: string) => JSON.stringify({ ...GOOD, app });
  /** A directory standing for a game's root, with `server/game.json` and `game.json` as asked. */
  const root = (files: { server?: string; plain?: string }) => {
    const dir = mkdtempSync(join(tmpdir(), "game-root-"));
    if (files.server !== undefined) {
      mkdirSync(join(dir, "server"));
      writeFileSync(join(dir, "server", "game.json"), game(files.server));
    }
    if (files.plain !== undefined) writeFileSync(join(dir, "game.json"), game(files.plain));
    return dir;
  };
  beforeEach(() => {
    delete process.env.GAME_SETTINGS;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.GAME_SETTINGS;
    else process.env.GAME_SETTINGS = saved;
  });

  it("prefers server/game.json under the working directory", () => {
    const dir = root({ server: "in-server", plain: "in-root" });
    const settings = loadGameSettings(undefined, dir);
    expect(settings.app).toBe("in-server");
    expect(settings.file).toBe(join(dir, "server", "game.json"));
  });
  it("falls back to game.json under the working directory", () => {
    const dir = root({ plain: "in-root" });
    const settings = loadGameSettings(undefined, dir);
    expect(settings.app).toBe("in-root");
    expect(settings.file).toBe(join(dir, "game.json"));
  });
  it("names every path it tried where there is none", () => {
    const dir = root({});
    expect(() => loadGameSettings(undefined, dir)).toThrow(join(dir, "server", "game.json"));
    expect(() => loadGameSettings(undefined, dir)).toThrow(join(dir, "game.json"));
  });
  it("lets GAME_SETTINGS take the place of both, and names only it where it is missing", () => {
    const dir = root({ server: "in-server", plain: "in-root" });
    const other = join(mkdtempSync(join(tmpdir(), "game-named-")), "named.json");
    writeFileSync(other, game("named"));
    process.env.GAME_SETTINGS = other;
    expect(loadGameSettings(undefined, dir).app).toBe("named");
    process.env.GAME_SETTINGS = join(dir, "absent.json");
    expect(() => loadGameSettings(undefined, dir)).toThrow("absent.json");
    expect(() => loadGameSettings(undefined, dir)).not.toThrow(/tried .*server/);
  });
});

describe("where the saved queries are", () => {
  const at = (queries?: string) => ({ ...GOOD, ...(queries !== undefined ? { queries } : {}), file: join("/games", "mine", "server", "game.json") });
  it("is tools/telemetry/queries under the working directory where the file names none", () => {
    expect(queriesDirOf(at(), "/games/mine")).toBe(join("/games/mine", "tools", "telemetry", "queries"));
  });
  it("is the file's own folder's path where it names one, whatever the working directory", () => {
    expect(queriesDirOf(at("queries"), "/elsewhere")).toBe(resolve("/games/mine/server/queries"));
    expect(queriesDirOf(at("../tools/telemetry/queries"), "/elsewhere")).toBe(resolve("/games/mine/tools/telemetry/queries"));
  });
});
