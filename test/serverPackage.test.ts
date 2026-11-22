import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The server (`server/`) is a workspace of this repository and a package of its own, released as a
 * second tarball under the engine's version. These hold that it stays one.
 */

const read = (path: string): Record<string, unknown> => JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"));
const engine = read("../package.json");
const server = read("../server/package.json");

describe("the server package", () => {
  it("is the engine's version, so a release's two tarballs carry one number", () => {
    expect(server.name).toBe("@csarkosh/engine-server");
    expect(server.version).toBe(engine.version);
  });
  it("is a workspace of the repository whose own tarball does not hold it", () => {
    expect(engine.workspaces).toEqual(["server"]);
    expect(engine.files).not.toContain("server");
    for (const entry of engine.files as string[]) expect(entry.startsWith("server"), entry).toBe(false);
  });
  it("packs its compiled code and its README, built first", () => {
    expect(server.files).toEqual(["dist", "README.md"]);
    expect((server.scripts as Record<string, string>).prepack).toBe("npm run build");
    expect(server.main).toBe("dist/index.js");
  });
});
