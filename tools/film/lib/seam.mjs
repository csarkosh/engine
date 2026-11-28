// Does a looping film's last frame meet its first? Compares that jump with the film's own frame-to-frame steps.

const meanAbsDiff = (a, b) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
};

/** `frames` are grayscale, `width*height` bytes each. `ok` when the seam is no bigger than the largest step. */
export function seamReport(frames, width, height) {
  void width;
  void height;
  const seam = meanAbsDiff(frames.at(-1), frames[0]);
  const steps = frames.slice(1).map((f, i) => meanAbsDiff(frames[i], f)).sort((a, b) => a - b);
  const mid = steps.length >> 1;
  const medianStep = steps.length === 0 ? 0 : steps.length % 2 ? steps[mid] : (steps[mid - 1] + steps[mid]) / 2;
  const maxStep = steps.length === 0 ? 0 : steps.at(-1);
  return { seam, medianStep, maxStep, ok: seam <= maxStep };
}
