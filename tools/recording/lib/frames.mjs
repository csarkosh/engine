import { readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";

// Which frames a film recording needs, and in what runs: pure, so a resumed run is testable.

/** Every frame time `i/fps`, for `i` in `0 .. recordSeconds*fps - 1`. */
export function frameTimes(def) {
  const seconds = def.recordSeconds ?? def.seconds + (def.loop?.blend ?? 0);
  const count = Math.round(seconds * def.fps);
  return Array.from({ length: count }, (_, i) => i / def.fps);
}

/** The frames of `times` whose index is not in `existing`, as `{ index, t }`. */
export function missing(times, existing) {
  const out = [];
  times.forEach((t, index) => {
    if (!existing.has(index)) out.push({ index, t });
  });
  return out;
}

/** `list` (`{ index, t }`, ascending) split into runs of consecutive indexes; each run starts with a seek. */
export function runs(list) {
  const out = [];
  for (const frame of list) {
    const run = out.at(-1);
    if (run !== undefined && run.at(-1).index + 1 === frame.index) run.push(frame);
    else out.push([frame]);
  }
  return out;
}

/** Writes `data` to `path` through `path.tmp` and a rename, so a killed run leaves no truncated file under the real name. */
export function writeAtomic(path, data) {
  writeFileSync(`${path}.tmp`, data);
  renameSync(`${path}.tmp`, path);
}

/** The indexes of the `frame-NNNNNN.png` files in `dir`; leftover `*.tmp` files (a killed write) are deleted and not counted. */
export function existingFrames(dir) {
  const found = new Set();
  for (const f of readdirSync(dir)) {
    if (f.endsWith(".tmp")) rmSync(`${dir}/${f}`, { force: true });
    else if (/^frame-(\d{6})\.png$/.test(f)) found.add(Number(f.slice(6, 12)));
  }
  return found;
}

/** `indexes` (ascending) as ranges for a message: `0-2, 7, 9-11`. */
export function indexRanges(indexes) {
  const out = [];
  for (const i of indexes) {
    const last = out.at(-1);
    if (last !== undefined && last[1] + 1 === i) last[1] = i;
    else out.push([i, i]);
  }
  return out.map(([a, b]) => (a === b ? String(a) : `${a}-${b}`)).join(", ");
}

/** The width and height a PNG's header gives; null when `bytes` is no PNG. */
export function pngSize(bytes) {
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47 || bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * What keeps the frames in `dir` from being encoded as `def`'s film: frames missing from `0 .. recordSeconds*fps - 1`,
 * and a first frame whose size is not the film's. Empty means they can be encoded.
 */
export function framesProblems(dir, def) {
  const count = frameTimes(def).length;
  const present = existingFrames(dir);
  const absent = [];
  for (let i = 0; i < count; i++) if (!present.has(i)) absent.push(i);
  const out = [];
  if (absent.length > 0) out.push(`${absent.length} of ${count} frames are missing from ${dir}: ${indexRanges(absent)}`);
  if (present.has(0)) {
    const size = pngSize(readFileSync(`${dir}/frame-000000.png`));
    if (size === null) out.push("frame-000000.png is not a PNG");
    else if (size.width !== def.width || size.height !== def.height) {
      out.push(`frame-000000.png is ${size.width} x ${size.height}, the film is ${def.width} x ${def.height}`);
    }
  }
  return out;
}

/**
 * What a run does with a directory already holding `previous` (its `film.json`, parsed; null for none) and
 * `framesPresent` frames, for the film `def`: `new` (nothing there), `resume` (the same film by its digest), `fresh`
 * (`--fresh`: the frames are cleared first) or `refuse`, with why.
 */
export function resumeDecision(previous, def, { fresh = false, framesPresent = 0 } = {}) {
  if (fresh) return { kind: "fresh" };
  if (previous === null) {
    if (framesPresent === 0) return { kind: "new" };
    return { kind: "refuse", reason: `${framesPresent} frames are there with no film.json to say which film they are of: pass --fresh to clear them and start again` };
  }
  const was = previous.def?.digest;
  if (was !== def.digest) {
    return { kind: "refuse", reason: `the frames there are of another film (digest ${was ?? "none"}, this one's ${def.digest}): pass --fresh to clear them and start again` };
  }
  return { kind: "resume" };
}

/** The `film.json` a run writes: a resumed run keeps the first run's `started` and adds its own time to `resumed`. */
export function filmRecord(previous, decision, { def, url, build, now }) {
  if (decision.kind === "resume" && previous !== null) {
    return { ...previous, def, url, build: previous.build ?? build, started: previous.started, resumed: [...(previous.resumed ?? []), now] };
  }
  return { def, url, build, started: now };
}

/** Deletes the `frame-NNNNNN.png` files (and leftover `*.tmp`) in `dir`; returns how many frames went. */
export function clearFrames(dir) {
  let n = 0;
  for (const f of readdirSync(dir)) {
    if (/^frame-\d{6}\.png$/.test(f)) {
      rmSync(`${dir}/${f}`, { force: true });
      n += 1;
    } else if (f.endsWith(".tmp")) rmSync(`${dir}/${f}`, { force: true });
  }
  return n;
}

/** `promise`, or a rejection with `message` once `ms` have gone; the timer never holds the process open after. */
export async function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
