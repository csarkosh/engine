// Finding Chrome and starting it from a throwaway profile. Nothing here names a machine: the
// browser is `CHROME` or `--chrome` if given, else the first of the usual places that exists.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The usual install places of Chrome (and Chromium) on `platform`. */
export function chromeCandidates(platform, env = process.env) {
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }
  if (platform === "win32") {
    return [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA]
      .filter((dir) => dir !== undefined)
      .map((dir) => join(dir, "Google", "Chrome", "Application", "chrome.exe"));
  }
  return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"];
}

/**
 * The browser to start: `chrome` (the `--chrome` option) or `env.CHROME` if either is set, which
 * must exist; else the first usual place that exists. Throws a message that says what was looked
 * for and how to name another.
 */
export function findChrome({ chrome, env = process.env, platform = process.platform, exists = existsSync } = {}) {
  const named = chrome ?? env.CHROME;
  if (named !== undefined && named !== "") {
    if (!exists(named)) throw new Error(`Chrome not found at ${named} (from ${chrome !== undefined ? "--chrome" : "CHROME"})`);
    return named;
  }
  const candidates = chromeCandidates(platform, env);
  const found = candidates.find((path) => exists(path));
  if (found === undefined) {
    throw new Error(`no Chrome found; looked in ${candidates.join(", ")}. Set CHROME to the browser's path, or pass --chrome <path>.`);
  }
  return found;
}

/**
 * The flags of the browser: headless, WebGPU allowed, exact memory figures, and the window the
 * page is measured in. `--use-angle=metal` is the Mac's graphics path; elsewhere the browser's
 * own choice stands.
 */
export function chromeFlags({ profileDir, width, height, platform = process.platform }) {
  return [
    `--user-data-dir=${profileDir}`,
    "--remote-debugging-port=0",
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--enable-unsafe-webgpu",
    ...(platform === "darwin" ? ["--use-angle=metal"] : []),
    "--enable-precise-memory-info",
    `--window-size=${width},${height}`,
    "about:blank",
  ];
}

/**
 * Starts the browser on a profile directory of its own under the OS temp dir and a debugging port
 * the system picks (so nothing else's port is taken). Returns `{ profileDir, port, wsUrl, close }`;
 * `close()` quits the browser and removes the profile, and may be called more than once.
 */
export async function launchChrome({ chrome, width, height }) {
  const profileDir = mkdtempSync(join(tmpdir(), "engine-memory-"));
  const proc = spawn(chrome, chromeFlags({ profileDir, width, height }), { stdio: "ignore" });
  let closing;
  const close = () => {
    closing ??= (async () => {
      if (proc.exitCode === null) proc.kill("SIGTERM");
      for (let i = 0; proc.exitCode === null && i < 25; i++) await sleep(200);
      if (proc.exitCode === null) proc.kill("SIGKILL");
      // A helper still writing as it exits can make the first removal fail; it is a temp dir, never a failure.
      try { rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* left for the OS */ }
    })();
    return closing;
  };
  try {
    const portFile = join(profileDir, "DevToolsActivePort");
    for (let i = 0; !existsSync(portFile); i++) {
      if (proc.exitCode !== null) throw new Error(`Chrome exited (code ${proc.exitCode}) before it opened its debugging port`);
      if (i > 150) throw new Error("Chrome did not open its debugging port");
      await sleep(200);
    }
    const [port, path] = readFileSync(portFile, "utf8").split(/\r?\n/);
    return { profileDir, port: Number(port), wsUrl: `ws://127.0.0.1:${port}${path}`, close };
  } catch (error) {
    await close();
    throw error;
  }
}
