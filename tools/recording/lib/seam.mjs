// Does a looping film's last frame meet its first? Compares that jump with the film's own frame-to-frame steps.

const meanAbsDiff = (a, b) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
};

/**
 * `frames` are grayscale, `width*height` bytes each. `ok` when the seam is no bigger than the largest step;
 * `seamToMedian` says how it compares with a typical step (1 is a step like any other).
 */
export function seamReport(frames, width, height) {
  // The frames are compared as flat arrays of the same length: the size is the caller's record of what they are, unused here.
  void width;
  void height;
  const seam = meanAbsDiff(frames.at(-1), frames[0]);
  const steps = frames.slice(1).map((f, i) => meanAbsDiff(frames[i], f)).sort((a, b) => a - b);
  const mid = steps.length >> 1;
  const medianStep = steps.length === 0 ? 0 : steps.length % 2 ? steps[mid] : (steps[mid - 1] + steps[mid]) / 2;
  const maxStep = steps.length === 0 ? 0 : steps.at(-1);
  const seamToMedian = medianStep > 0 ? seam / medianStep : seam > 0 ? Number.POSITIVE_INFINITY : 0;
  return { seam, medianStep, maxStep, seamToMedian, ok: seam <= maxStep };
}
