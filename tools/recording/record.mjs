// Records a film page's frames over the Chrome DevTools Protocol.
//
//   node tools/recording/record.mjs --url <film page> --out <dir> [--remote <port>] [--stills t1,t2,...]
//     [--fresh] [--allow-unsettled] [--frame-timeout <s>]
//
// The page exposes `window.engineFilm` (`src/game/film/filmApi.ts`). The viewport is set to the film's size at
// device scale 1; once `ready` resolves (and `problems` is empty) each missing frame is drawn with `frame()`
// (after a `seek` where a run starts) and captured as `frame-<6 digits>.png`. Frames already in --out are kept,
// so a stopped run resumes, but only into frames of the same film: `film.json`'s `def.digest` must be this film's,
// or the run is refused; --fresh clears the frames there and starts again. `film.json` records the definition,
// the page URL, the build's tag, when the first run started and when each later one resumed.
// A frame whose world did not settle is named as it is drawn and not kept; the run then fails with their count,
// so running it again draws them again. --allow-unsettled keeps them. A frame that takes longer than
// --frame-timeout seconds (120) fails the run.
// --stills writes `still-<t>.png` at those times only, and warns of the path's problems rather than refusing.
// Without --out, frames go to $ENGINE_LAB/film/<name> (the external disk); with no ENGINE_LAB either, the run is refused.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { attachChrome, closeStrayPages, evaluate, launchChrome, openPage } from "../frame-budget/lib/cdp.mjs";
import { clearFrames, existingFrames, filmRecord, frameTimes, indexRanges, missing, resumeDecision, runs, withTimeout, writeAtomic } from "./lib/frames.mjs";

const READY_TIMEOUT_MS = 10 * 60 * 1000;
const FRAME_TIMEOUT_S = 120;
const pad = (n) => String(n).padStart(6, "0");

function parseArgs(argv) {
  const o = { url: undefined, out: undefined, remote: undefined, stills: [], fresh: false, allowUnsettled: false, frameTimeout: FRAME_TIMEOUT_S };
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
    else if (a === "--fresh") o.fresh = true;
    else if (a === "--allow-unsettled") o.allowUnsettled = true;
    else if (a === "--frame-timeout") o.frameTimeout = Number(value());
    else throw new Error(`unknown argument ${a}`);
  }
  if (o.url === undefined) throw new Error("--url <film page> is required");
  if (o.remote !== undefined && !Number.isInteger(o.remote)) throw new Error("--remote needs a port number");
  if (o.stills.some((t) => !Number.isFinite(t) || t < 0)) throw new Error("--stills needs times in seconds, like 0,12.5");
  if (!Number.isFinite(o.frameTimeout) || o.frameTimeout <= 0) throw new Error("--frame-timeout needs a number of seconds over 0");
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

/** `film.json` in `dir`, parsed; null when there is none. */
function readRecord(dir) {
  const path = `${dir}/film.json`;
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path} cannot be read (${error.message}): pass --fresh to clear the frames there and start again`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const now = new Date().toISOString();
  const session = options.remote !== undefined ? await attachChrome(options.remote) : await launchChrome();
  let opened;
  try {
    if (options.remote !== undefined) {
      // A page an earlier run left drawing would share the GPU with every frame (`closeStrayPages`).
      const strays = await closeStrayPages(session.port);
      if (strays.length > 0) process.stdout.write(`closed ${strays.length} page(s) an earlier run left open:\n${strays.map((u) => `  ${u}\n`).join("")}`);
    }
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

    const ready = page("Runtime.evaluate", { expression: "window.engineFilm.ready", awaitPromise: true, returnByValue: true }).then((r) => {
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    });
    await withTimeout(ready, READY_TIMEOUT_MS, "the film was not ready after 10 minutes");

    const problems = await evaluate(page, "window.engineFilm.problems");
    const listed = problems.map((p) => `  ${p}`).join("\n");
    if (problems.length > 0 && options.stills.length === 0) throw new Error(`the film's camera path has problems:\n${listed}`);
    if (problems.length > 0) process.stderr.write(`warning: the film's camera path has problems (stills are taken all the same):\n${listed}\n`);

    mkdirSync(dir, { recursive: true });
    const build = await evaluate(page, "(globalThis.VITE_BUILD_SHA ?? document.documentElement.dataset.build ?? null)").catch(() => null);
    const frameMs = options.frameTimeout * 1000;
    /** Draws the next frame; its `{ settled, draws }`, or a failed run once it takes longer than --frame-timeout. */
    const drawFrame = (what) => withTimeout(evaluate(page, "window.engineFilm.frame()"), frameMs, `${what} took longer than ${options.frameTimeout} s (--frame-timeout)`);

    if (options.stills.length > 0) {
      // Stills are no recording: they leave the frames, and a film.json already there, as they are.
      if (readRecord(dir) === null) writeAtomic(`${dir}/film.json`, `${JSON.stringify(filmRecord(null, { kind: "new" }, { def, url: options.url, build, now }), null, 2)}\n`);
      for (const t of options.stills) {
        await evaluate(page, `window.engineFilm.seek(${t})`);
        const result = await drawFrame(`the still at ${t} s`);
        if (!result.settled) process.stderr.write(`warning: the still at ${t} s did not settle after ${result.draws} draws\n`);
        writeAtomic(`${dir}/still-${t}.png`, await capture(page));
        process.stdout.write(`still-${t}.png\n`);
      }
      return;
    }

    const previous = options.fresh ? null : readRecord(dir);
    const decision = resumeDecision(previous, def, { fresh: options.fresh, framesPresent: existingFrames(dir).size });
    if (decision.kind === "refuse") throw new Error(`${dir}: ${decision.reason}`);
    if (decision.kind === "fresh") process.stdout.write(`--fresh: cleared ${clearFrames(dir)} frames from ${dir}\n`);
    if (decision.kind === "resume" && previous?.build != null && build != null && previous.build !== build) {
      process.stderr.write(`warning: resuming frames recorded by build ${previous.build} with build ${build}\n`);
    }
    writeAtomic(`${dir}/film.json`, `${JSON.stringify(filmRecord(previous, decision, { def, url: options.url, build, now }), null, 2)}\n`);

    const times = frameTimes(def);
    const existing = existingFrames(dir);
    const todo = missing(times, existing);
    process.stdout.write(`${def.name}: ${times.length} frames, ${existing.size} present, ${todo.length} to record\n`);
    let done = 0;
    const unsettled = [];
    for (const run of runs(todo)) {
      await evaluate(page, `window.engineFilm.seek(${run[0].t})`);
      for (const { index, t } of run) {
        const result = await drawFrame(`frame ${index} (t=${t.toFixed(3)} s)`);
        if (!result.settled) {
          unsettled.push(index);
          process.stderr.write(`frame ${index} (t=${t.toFixed(3)} s) did not settle after ${result.draws} draws${options.allowUnsettled ? ": kept (--allow-unsettled)" : ": not kept"}\n`);
          if (!options.allowUnsettled) continue;
        }
        writeAtomic(`${dir}/frame-${pad(index)}.png`, await capture(page));
        if (++done % 100 === 0) process.stdout.write(`  ${done}/${todo.length}\n`);
      }
    }
    if (unsettled.length > 0 && !options.allowUnsettled) {
      throw new Error(`${unsettled.length} frame(s) did not settle and were not kept (${indexRanges(unsettled)}): run again to draw them again, or pass --allow-unsettled to keep them as they stand`);
    }
    if (unsettled.length > 0) process.stdout.write(`${unsettled.length} frame(s) kept unsettled (--allow-unsettled): ${indexRanges(unsettled)}\n`);
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
