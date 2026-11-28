import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));

describe("the package a game installs", () => {
  it("carries the recorder, its library and the DevTools client it reads, and none of the tools' tests", () => {
    const r = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts", "--workspaces=false"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
    expect(r.status, r.stderr).toBe(0);
    const files = JSON.parse(r.stdout)[0].files.map((f) => f.path);
    for (const want of ["tools/recording/record.mjs", "tools/recording/encode.mjs", "tools/frame-budget/lib/cdp.mjs"]) expect(files).toContain(want);
    for (const lib of ["encodeArgs.mjs", "frames.mjs", "seam.mjs"]) expect(files).toContain(`tools/recording/lib/${lib}`);
    expect(files.filter((f) => /^tools\/(?:.*\/)?test\//.test(f))).toEqual([]);
  }, 60_000);
});
