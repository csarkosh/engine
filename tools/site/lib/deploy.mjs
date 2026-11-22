// One game's deploy to a shared Hosting site. A Hosting deploy replaces the whole site, so this one
// builds the new version from the live one on the server: clone the live version without the files
// this deploy owns, add the local files, put the merged config on it, check it, and only then release it.
import { createApi } from './api.mjs';
import { mergeConfig } from './config.mjs';
import { checkNewVersion, describeProblems } from './guard.mjs';
import { readGzipped, planFiles } from './local.mjs';
import { diffFiles, planLines } from './plan.mjs';

/** Files in one populateFiles call, and uploads in flight at once. */
const BATCH = 1000;
const UPLOADS = 8;

/** Runs `fn` over `items`, at most `limit` at once; after the first failure no more are started, and it throws that failure. */
async function pool(items, limit, fn) {
  let next = 0;
  let failure;
  const worker = async () => {
    while (failure === undefined && next < items.length) {
      const item = items[next++];
      try {
        await fn(item);
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure) throw failure.error;
}

const messageOf = (error) => (error instanceof Error ? error.message : String(error));

/**
 * Deploys. Everything outside is handed in: `fetch`, `token`, `log` (a line of output) and `sleep`.
 * `rules` is `{ redirects, rewrites, headers }` in the API's form, already checked against the owner.
 * Returns what was done: `{ dryRun, version, released, address, counts }`.
 */
export async function deploy({
  fetch,
  token,
  log,
  sleep,
  project,
  site,
  path,
  dir,
  rootDir,
  rules = {},
  channel,
  expiresDays = 7,
  message,
  dryRun = false,
}) {
  const api = createApi({ fetch, token, project, sleep });
  const owner = { path, root: rootDir !== undefined };

  // 1. The live version. Without one there is nothing to build on, and a first deploy of a site is not this tool's.
  const live = await api.getLive(site);
  if (!live) throw new Error(`site ${site} has no live release: it has never been deployed, and this tool only updates one game's path of a site that is already live`);

  // 2. The local files.
  const local = planFiles({ dir, path, rootDir });
  const planned = local.files;

  // 3. The plan.
  const liveFiles = await api.listFiles(live.name);
  const diff = diffFiles({ liveFiles, planned, owner });
  const mergedConfig = mergeConfig(live.config, rules, owner);
  const counts = { added: diff.added.length, changed: diff.changed.length, unchanged: diff.unchanged.length, removed: diff.removed.length, kept: diff.kept };
  for (const line of planLines({ live: live.name, liveFileCount: liveFiles.length, diff, skipped: local.skipped, liveConfig: live.config, mergedConfig })) log(line);
  if (dryRun) {
    log('dry run: nothing was written');
    return { dryRun: true, version: undefined, released: false, address: undefined, counts };
  }

  // 4. The clone: the live version without this deploy's files.
  const exclude = [`^${path}/.*$`];
  if (owner.root) exclude.push('^/[^/]+$');
  log(`cloning ${live.name} without ${exclude.join(' and ')}`);
  const created = await api.clone(site, live.name, exclude);
  const version = created.name;

  // Everything from here to the release leaves the new version behind if it fails, so it is deleted.
  try {
    // 5. The files.
    const byHash = new Map();
    for (const file of planned) if (!byHash.has(file.hash)) byHash.set(file.hash, file);
    const uploaded = new Set();
    for (let start = 0; start < planned.length; start += BATCH) {
      const batch = planned.slice(start, start + BATCH);
      const { hashes, uploadUrl } = await api.populateFiles(version, Object.fromEntries(batch.map((f) => [f.path, f.hash])));
      const needed = [...new Set(hashes)].filter((hash) => !uploaded.has(hash));
      if (needed.length > 0 && !uploadUrl) throw new Error(`populateFiles asked for ${needed.length} uploads and gave no uploadUrl`);
      for (const hash of needed) {
        if (!byHash.has(hash)) throw new Error(`populateFiles asked for the hash ${hash}, which is none of this deploy's files`);
      }
      log(`files ${start + 1}-${start + batch.length} of ${planned.length}: ${needed.length} to upload`);
      await pool(needed, UPLOADS, async (hash) => {
        await api.upload(uploadUrl, hash, readGzipped(byHash.get(hash)));
        uploaded.add(hash);
      });
    }

    // 6. The merged config, and the version finished.
    await api.patchConfig(version, mergedConfig);
    await api.finalize(version);

    // 7. The guard.
    const newFiles = await api.listFiles(version);
    const problems = checkNewVersion({ liveFiles, newFiles, planned, owner });
    if (problems.length > 0) throw new Error(`nothing was released: ${describeProblems(problems)}`);

    // 8. Live only: if another deploy released meanwhile, this version lacks its work.
    if (channel === undefined) {
      const now = await api.getLive(site);
      if (now?.name !== live.name) throw new Error('the site changed while this deploy ran; run it again');
    }

    // 9. The release.
    let address;
    if (channel === undefined) {
      await api.releaseLive(site, version, message ?? `Deploy ${path}`);
    } else {
      const url = await api.ensureChannel(site, channel, expiresDays);
      await api.releaseToChannel(site, channel, version);
      address = `${url}${path}`;
    }
    log(`released ${version} to ${channel === undefined ? 'live' : `channel ${channel}`}`);
    log(`${counts.added} new, ${counts.changed} changed, ${counts.unchanged} unchanged, ${counts.removed} removed; ${counts.kept} files of others kept`);
    if (address) log(address);
    return { dryRun: false, version, released: true, address, counts };
  } catch (error) {
    let text = messageOf(error);
    try {
      await api.deleteVersion(version);
    } catch (deleteError) {
      text += `\nthe new version ${version} could not be deleted either: ${messageOf(deleteError)}`;
    }
    throw new Error(text, { cause: error });
  }
}
