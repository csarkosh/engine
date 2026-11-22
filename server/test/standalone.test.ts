import { describe, it, expect } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocket } from "ws";

/**
 * The server as a game runs it: the entry file as a process, started in a
 * folder holding only the game's `game.json`, the way an image's working
 * directory does. A game with no admin page has no saved queries and sets no
 * `ADMIN_EMAILS`, and its server must still start and serve; and no query file
 * is read at start-up even where the admin routes are on, only when one is asked.
 */

const ENTRY = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const TSX = pathToFileURL(join(dirname(createRequire(import.meta.url).resolve("tsx/package.json")), "dist", "loader.mjs")).href;
const ORIGIN = "http://localhost:5174";
const GAME = { app: "game-example", telemetryDataset: "example_telemetry", telemetryBucket: "example-telemetry", allowedOrigins: [ORIGIN] };

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return typeof address === "object" && address !== null ? address.port : 0;
}

type Running = { child: ChildProcess; port: number; stdout: () => string; stop: () => Promise<void> };

/** The server started in a new folder holding `game.json` and nothing else, on a free port, once it says it is listening. */
async function start(env: Record<string, string> = {}, files: Record<string, string> = { "game.json": JSON.stringify(GAME) }): Promise<Running> {
  const cwd = mkdtempSync(join(tmpdir(), "engine-server-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(cwd, name), text);
  const port = await freePort();
  // No inherited environment: the test run's own settings file must not reach the process.
  const child = spawn(process.execPath, ["--import", TSX, ENTRY], { cwd, env: { PATH: process.env.PATH ?? "", PORT: String(port), REGISTRY: "memory", ...env } });
  let out = "";
  let err = "";
  child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
  const stop = async () => {
    if (child.exitCode !== null) return;
    const closed = new Promise((resolve) => child.once("close", resolve));
    child.kill("SIGTERM");
    await closed;
  };
  const deadline = Date.now() + 20_000;
  while (!out.includes("listening on")) {
    if (child.exitCode !== null) throw new Error(`the server exited with ${child.exitCode}: ${err}`);
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`the server did not start: ${out} ${err}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return { child, port, stdout: () => out, stop };
}

describe("the server run as a process in a game's folder", () => {
  it("starts with no queries folder and no ADMIN_EMAILS, finds game.json in its working directory, and serves signaling and telemetry", async () => {
    const server = await start();
    try {
      expect(server.stdout()).toContain(`allowing origins: ${ORIGIN}`);
      expect(server.stdout()).toContain("admin routes off (no ADMIN_EMAILS)");
      const base = `http://127.0.0.1:${server.port}`;

      const health = await fetch(`${base}/healthcheck`);
      expect(health.status).toBe(200);
      expect(await health.text()).toBe("ok");

      const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, { origin: ORIGIN });
      const joined = new Promise<string>((resolve, reject) => {
        socket.once("message", (data) => resolve(String(data)));
        socket.once("error", reject);
      });
      await new Promise<void>((resolve, reject) => {
        socket.once("open", () => resolve());
        socket.once("error", reject);
      });
      socket.send(JSON.stringify({ t: "create", room: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", peerId: "host" }));
      expect(JSON.parse(await joined)).toMatchObject({ t: "joined", role: "host" });
      socket.close();

      const batch = JSON.stringify({ v: 1, sid: "s1", build: "abc1234", proto: 5, gen: 8, events: [{ n: "page", t: 1, kind: "landing" }] });
      const posted = await fetch(`${base}/t`, { method: "POST", body: batch, headers: { "content-type": "text/plain", origin: ORIGIN } });
      expect(posted.status).toBe(204);
      expect(posted.headers.get("access-control-allow-origin")).toBe(ORIGIN);

      // The routes are not served at all: with no account list there is nothing to answer them.
      const admin = await fetch(`${base}/admin/live`, { headers: { origin: ORIGIN } });
      expect(admin.status).toBe(404);
    } finally {
      await server.stop();
    }
  }, 30_000);

  it("reads no query file at start-up with the admin routes on, and refuses a request with no token", async () => {
    const server = await start({ ADMIN_EMAILS: "me@example.com", GOOGLE_CLOUD_PROJECT: "example-project" });
    try {
      expect(server.stdout()).toContain("admin routes on for 1 account(s)");
      const base = `http://127.0.0.1:${server.port}`;
      expect((await fetch(`${base}/healthcheck`)).status).toBe(200);
      for (const path of ["/admin/live", "/admin/kpis"]) {
        const res = await fetch(`${base}${path}`, { headers: { origin: ORIGIN } });
        expect(res.status, path).toBe(401);
      }
    } finally {
      await server.stop();
    }
  }, 30_000);

  it("stops before it listens, naming the file, where GAME_SETTINGS names none", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "engine-server-"));
    const missing = join(cwd, "nope.json");
    const child = spawn(process.execPath, ["--import", TSX, ENTRY], { cwd, env: { PATH: process.env.PATH ?? "", PORT: String(await freePort()), GAME_SETTINGS: missing } });
    let err = "";
    child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
    const code = await new Promise((resolve) => child.once("close", resolve));
    expect(code).not.toBe(0);
    expect(err).toContain(`game settings file not found: tried ${missing}`);
  }, 30_000);
});
