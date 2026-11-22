// The Firebase Hosting REST API, as far as a deploy needs it. `fetch`, `token` and `sleep` are handed
// in: the command line gives the real ones and the tests a fake Hosting API, so nothing here reaches
// the network or runs gcloud by itself.

export const BASE = 'https://firebasehosting.googleapis.com/v1beta1';

/** An API call that failed. `status` is the HTTP status (0 for a network error); `retryable` is true for a network error or a 5xx. */
export class ApiError extends Error {
  constructor(message, status, retryable) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryable = retryable;
  }
}

/** How often the clone's operation is asked after, and how many times: 120 times 1.5 s is 3 minutes. */
export const POLL_MS = 1500;
export const POLL_LIMIT = 120;
/** A file upload is tried three times in all. */
const UPLOAD_TRIES = 3;
const RETRY_MS = 1000;

/**
 * @param {{ fetch: typeof fetch, token: string, project: string, sleep: (ms: number) => Promise<void> }} deps
 */
export function createApi({ fetch, token, project, sleep }) {
  // A message never carries the token, whatever the server sent back.
  const scrub = (text) => (token ? text.split(token).join('***') : text);

  /** One call. `target` is a path under the API's base, or an absolute https URL (an operation's, an upload's). */
  async function call(method, target, { body, upload, parse = true } = {}) {
    const url = target.startsWith('https://') ? target : `${BASE}/${target}`;
    const parsed = new URL(url);
    const shown = `${parsed.pathname}${parsed.search}`;
    const headers = upload
      ? { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' }
      : { authorization: `Bearer ${token}`, 'x-goog-user-project': project, 'content-type': 'application/json' };
    let response;
    try {
      response = await fetch(url, { method, headers, body: upload ? body : body === undefined ? undefined : JSON.stringify(body) });
    } catch (error) {
      throw new ApiError(scrub(`${method} ${shown}: network error: ${error instanceof Error ? error.message : error}`), 0, true);
    }
    const text = await response.text();
    if (!response.ok) {
      throw new ApiError(scrub(`${method} ${shown}: HTTP ${response.status}: ${text.slice(0, 400)}`), response.status, response.status >= 500);
    }
    if (!parse || text === '') return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new ApiError(scrub(`${method} ${shown}: HTTP ${response.status} with a body that is not JSON: ${text.slice(0, 400)}`), response.status, false);
    }
  }

  /** The live version of a site (`{ name, status, fileCount, config }`), or null when the site has no live release. */
  async function getLive(site) {
    let channel;
    try {
      channel = await call('GET', `sites/${site}/channels/live`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
    return channel.release?.version ?? null;
  }

  /** Every file of a version, `[{ path, hash, status }]`, over all the pages. */
  async function listFiles(version) {
    const files = [];
    let token_ = '';
    do {
      const page = await call('GET', `${version}/files?pageSize=1000${token_ ? `&pageToken=${encodeURIComponent(token_)}` : ''}`);
      files.push(...(page.files ?? []));
      token_ = page.nextPageToken ?? '';
    } while (token_);
    return files;
  }

  /** Clones `source` without the files that match `regexes`, waits for the operation, and returns the new version. */
  async function clone(site, source, regexes) {
    const operation = await call('POST', `sites/${site}/versions:clone`, {
      body: { sourceVersion: source, finalize: false, exclude: { regexes } },
    });
    if (!operation.name) throw new ApiError(`POST sites/${site}/versions:clone: no operation name in the answer: ${JSON.stringify(operation).slice(0, 400)}`, 200, false);
    for (let i = 0; i < POLL_LIMIT; i++) {
      const state = await call('GET', operation.name);
      if (state.done) {
        if (state.error) throw new ApiError(`the clone failed: ${JSON.stringify(state.error).slice(0, 400)}`, 200, false);
        if (!state.response?.name) throw new ApiError(`the clone finished without a version: ${JSON.stringify(state).slice(0, 400)}`, 200, false);
        return state.response;
      }
      await sleep(POLL_MS);
    }
    throw new ApiError(`the clone (${operation.name}) was not done after ${(POLL_LIMIT * POLL_MS) / 60000} minutes`, 0, false);
  }

  /** Adds files (`{ "/a/b.html": hash }`) to a version; answers the hashes the server needs uploaded and where. */
  async function populateFiles(version, files) {
    const answer = await call('POST', `${version}:populateFiles`, { body: { files } });
    return { hashes: answer.uploadRequiredHashes ?? [], uploadUrl: answer.uploadUrl };
  }

  /** Uploads one file's gzipped bytes; a network error or a 5xx is tried again, twice. */
  async function upload(uploadUrl, hash, bytes) {
    for (let attempt = 1; ; attempt++) {
      try {
        await call('POST', `${uploadUrl}/${hash}`, { body: bytes, upload: true, parse: false });
        return;
      } catch (error) {
        if (!(error instanceof ApiError) || !error.retryable || attempt >= UPLOAD_TRIES) throw error;
        await sleep(RETRY_MS * attempt);
      }
    }
  }

  return {
    call,
    getLive,
    listFiles,
    clone,
    populateFiles,
    upload,
    patchConfig: (version, config) => call('PATCH', `${version}?update_mask=config`, { body: { config } }),
    finalize: (version) => call('PATCH', `${version}?update_mask=status`, { body: { status: 'FINALIZED' } }),
    releaseLive: (site, version, message) => call('POST', `sites/${site}/releases?versionName=${encodeURIComponent(version)}`, { body: { message } }),
    releaseToChannel: (site, channel, version) => call('POST', `sites/${site}/channels/${channel}/releases?versionName=${encodeURIComponent(version)}`, { body: {} }),
    deleteVersion: (version) => call('DELETE', version),
    /** The channel's address, made with the expiry when it does not exist yet. */
    async ensureChannel(site, channel, days) {
      try {
        return (await call('POST', `sites/${site}/channels?channelId=${channel}`, { body: { ttl: `${days * 86400}s` } })).url;
      } catch (error) {
        if (!(error instanceof ApiError) || !(error.status === 409 || /ALREADY_EXISTS/.test(error.message))) throw error;
        return (await call('GET', `sites/${site}/channels/${channel}`)).url;
      }
    },
  };
}
