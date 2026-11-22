// The files a deploy serves, read from disk: which ones, under which site paths, and the gzipped
// bytes Hosting wants (its file hash is the SHA-256 of the gzipped bytes).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const gzipped = (bytes) => gzipSync(bytes, { level: 9 });

/**
 * The files under `dir` as `{ rel, abs }`, sorted, with a count of what was skipped: a file or folder
 * whose name begins with `.` (counted once, a folder with its contents) and a file ending `.map`.
 * With `flat`, a folder (that is not hidden) is an error: the root's files are files and nothing more.
 */
export function listLocal(dir, { flat = false } = {}) {
  const files = [];
  const skipped = { hidden: 0, maps: 0 };
  const walk = (folder, prefix) => {
    const entries = readdirSync(folder, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const abs = join(folder, entry.name);
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.name.startsWith('.')) skipped.hidden++;
      else if (entry.isSymbolicLink()) throw new Error(`${abs} is a symbolic link: copy the file in place of it`);
      else if (entry.isDirectory()) {
        if (flat) throw new Error(`${abs} is a folder: the root's folder holds files only`);
        walk(abs, rel);
      } else if (entry.name.endsWith('.map')) skipped.maps++;
      else if (entry.isFile()) files.push({ rel, abs });
    }
  };
  walk(dir, '');
  return { files, skipped };
}

/** Throws when two planned files have one site path. */
export function assertUniquePaths(files) {
  const seen = new Map();
  for (const file of files) {
    if (seen.has(file.path)) throw new Error(`two local files would be served at ${file.path}: ${seen.get(file.path)} and ${file.abs}`);
    seen.set(file.path, file.abs);
  }
}

/**
 * Every file this deploy serves: `{ path, abs, hash, size }` (`size` the gzipped size), and what was
 * skipped. `dir` is served under `path`; `rootDir`, when given, at the root. Throws when a folder is
 * missing, `dir` has no `index.html`, or a file is not servable.
 */
export function planFiles({ dir, path, rootDir }) {
  const isDir = (folder) => existsSync(folder) && statSync(folder).isDirectory();
  if (!isDir(dir)) throw new Error(`--dir ${dir} is not a folder`);
  if (!existsSync(join(dir, 'index.html')) || !statSync(join(dir, 'index.html')).isFile()) throw new Error(`--dir ${dir} holds no index.html`);
  if (rootDir !== undefined && !isDir(rootDir)) throw new Error(`--root-dir ${rootDir} is not a folder`);
  const main = listLocal(dir);
  const root = rootDir === undefined ? { files: [], skipped: { hidden: 0, maps: 0 } } : listLocal(rootDir, { flat: true });
  const entries = [
    ...main.files.map((f) => ({ path: `${path}/${f.rel}`, abs: f.abs })),
    ...root.files.map((f) => ({ path: `/${f.rel}`, abs: f.abs })),
  ];
  assertUniquePaths(entries);
  // The bytes are not kept: a game's files can add up to far more than is good to hold. The ones
  // that need uploading are read and gzipped again (`readGzipped`), and checked against this hash.
  const files = entries.map((entry) => {
    const bytes = gzipped(readFileSync(entry.abs));
    return { ...entry, hash: sha256(bytes), size: bytes.length };
  });
  return { files, skipped: { hidden: main.skipped.hidden + root.skipped.hidden, maps: main.skipped.maps + root.skipped.maps } };
}

/** A planned file's gzipped bytes, read again; throws when the file has changed since it was planned. */
export function readGzipped(file) {
  const bytes = gzipped(readFileSync(file.abs));
  if (sha256(bytes) !== file.hash) throw new Error(`${file.abs} changed while the deploy ran; run it again`);
  return bytes;
}
