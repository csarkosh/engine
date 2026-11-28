// Records a film page's frames over the Chrome DevTools Protocol.
//
//   node tools/recording/record.mjs --url <film page> --out <dir> [--remote <port>] [--stills t1,t2,...]
//
// The page exposes `window.engineFilm` (`src/game/film/filmApi.ts`). The viewport is set to the film's size at
// device scale 1; once `ready` resolves (and `problems` is empty) each missing frame is drawn with `frame()`
// (after a `seek` where a run starts) and captured as `frame-<6 digits>.png`. Frames already in --out are kept,
// so a stopped run resumes. --stills writes `still-<t>.png` at those times only. `film.json` records the
// definition, the page URL, the build's tag and when the run started.
// Without --out, frames go to $ENGINE_LAB/film/<name> (the external disk); with no ENGINE_LAB either, the run is refused.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { attachChrome, evaluate, launchChrome, openPage } from "../frame-budget/lib/cdp.mjs";
import { existingFrames, frameTimes, missing, runs, writeAtomic } from "./lib/frames.mjs";

const READY_TIMEOUT_MS = 10 * 60 * 1000;
const pad = (n) => String(n).padStart(6, "0");

function parseArgs(argv) {
  const o = { url: undefined, out: undefined, remote: undefined, stills: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--url") o.url = value();
    else if (a === "--out") o.out = value();
    else if (a === "--remote") o.remote = Number(value());
    else if (a === "--stills") o.stills = value().split(",").map(Number);
    else throw new Error(`unknown argument ${a}`);
  }
  if (o.url === undefined) throw new Error("--url <film page> is required");
  if (o.remote !== undefined && !Number.isInteger(o.remote)) throw new Error("--remote needs a port number");
  if (o.stills.some((t) => !Number.isFinite(t) || t < 0)) throw new Error("--stills needs times in seconds, like 0,12.5");
  return o;
}

/** The output directory: an explicit --out as given; otherwise `film/<name>` under ENGINE_LAB (the external disk), never anywhere else. */
function outputDir(out, name) {
  if (out !== undefined) return resolve(out);
  const lab = process.env.ENGINE_LAB;
  if (lab === undefined || lab === "") throw new Error("ENGINE_LAB is not set and no --out was given: frames never go to the internal disk by default");
  return resolve(lab, "film", name);
}

async function capture(page) {
  const shot = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  return Buffer.from(shot.data, "base64");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const started = new Date().toISOString();
  const session = options.remote !== undefined ? await attachChrome(options.remote) : await launchChrome();
  let opened;
  try {
    opened = await openPage(session.browser, session.port, { origin: new URL(options.url).origin });
    const { page } = opened;
    const nav = await page("Page.navigate", { url: options.url });
    if (nav.errorText) throw new Error(`${options.url} did not load: ${nav.errorText}`);
    for (let i = 0; !(await evaluate(page, "typeof window.engineFilm === 'object'").catch(() => false)); i++) {
      if (i > 240) throw new Error(`window.engineFilm never appeared at ${options.url}`);
      await new Promise((r) => setTimeout(r, 500));
    }
    const def = await evaluate(page, "window.engineFilm.def");
    const dir = outputDir(options.out, def.name);
    await page("Emulation.setDeviceMetricsOverride", { width: def.width, height: def.height, deviceScaleFactor: 1, mobile: false });

    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("the film was not ready after 10 minutes")), READY_TIMEOUT_MS);
    });
    const ready = page("Runtime.evaluate", { expression: "window.engineFilm.ready", awaitPromise: true, returnByValue: true }).then((r) => {
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    });
    try {
      await Promise.race([ready, timeout]);
    } finally {
      clearTimeout(timer);
    }

    const problems = await evaluate(page, "window.engineFilm.problems");
    if (problems.length > 0) throw new Error(`the film's camera path has problems:\n${problems.map((p) => `  ${p}`).join("\n")}`);

    mkdirSync(dir, { recursive: true });
    const build = await evaluate(page, "(globalThis.VITE_BUILD_SHA ?? document.documentElement.dataset.build ?? null)").catch(() => null);
    writeAtomic(`${dir}/film.json`, `${JSON.stringify({ def, url: options.url, build, started }, null, 2)}\n`);

    if (options.stills.length > 0) {
      for (const t of options.stills) {
        await evaluate(page, `window.engineFilm.seek(${t})`);
        await evaluate(page, "window.engineFilm.frame()");
        writeAtomic(`${dir}/still-${t}.png`, await capture(page));
        process.stdout.write(`still-${t}.png\n`);
      }
      return;
    }

    const times = frameTimes(def);
    const existing = existingFrames(dir);
    const todo = missing(times, existing);
    process.stdout.write(`${def.name}: ${times.length} frames, ${existing.size} present, ${todo.length} to record\n`);
    let done = 0;
    for (const run of runs(todo)) {
      await evaluate(page, `window.engineFilm.seek(${run[0].t})`);
      for (const { index } of run) {
        await evaluate(page, "window.engineFilm.frame()");
        writeAtomic(`${dir}/frame-${pad(index)}.png`, await capture(page));
        if (++done % 100 === 0) process.stdout.write(`  ${done}/${todo.length}\n`);
      }
    }
    process.stdout.write(`done: ${dir}\n`);
  } finally {
    await opened?.close();
    await session.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
