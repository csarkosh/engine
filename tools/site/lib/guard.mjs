// The check before a release. A clone that the server did not make whole, or a bug here, would put a
// site live with another game's files gone or changed; nothing is released until the new version is
// seen to be what it should be. Pure.
import { ownsFile } from './owns.mjs';

/**
 * Compares the live version's files with the new version's. Returns the problems, one sentence each;
 * none means the new version may be released.
 *  - every live file this deploy does not own is in the new version with the same hash;
 *  - every planned file is in the new version with its hash;
 *  - the new version holds no other file this deploy owns.
 * `liveFiles` and `newFiles` are `[{ path, hash }]`, `planned` likewise.
 */
export function checkNewVersion({ liveFiles, newFiles, planned, owner }) {
  const now = new Map(newFiles.map((f) => [f.path, f.hash]));
  const problems = [];
  for (const file of liveFiles) {
    if (ownsFile(owner, file.path)) continue;
    if (!now.has(file.path)) problems.push(`${file.path} of another game is missing from the new version`);
    else if (now.get(file.path) !== file.hash) problems.push(`${file.path} of another game has changed in the new version`);
  }
  const wanted = new Set(planned.map((f) => f.path));
  for (const file of planned) {
    if (!now.has(file.path)) problems.push(`${file.path} is missing from the new version`);
    else if (now.get(file.path) !== file.hash) problems.push(`${file.path} is in the new version with another hash than the one sent`);
  }
  for (const file of newFiles) {
    if (ownsFile(owner, file.path) && !wanted.has(file.path)) problems.push(`${file.path} is in the new version, and this deploy does not serve it`);
  }
  return problems;
}

/** The problems as one message, the first `max` of them and a count of the rest. */
export function describeProblems(problems, max = 20) {
  const shown = problems.slice(0, max).map((p) => `  ${p}`);
  if (problems.length > max) shown.push(`  ... and ${problems.length - max} more`);
  return `${problems.length} problem${problems.length === 1 ? '' : 's'} with the new version:\n${shown.join('\n')}`;
}
