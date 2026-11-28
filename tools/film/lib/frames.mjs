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
