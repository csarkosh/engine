// A small in-memory Firebase Hosting API for the deploy's tests: versions with their files and config,
// the site's content store, channels, releases, the clone with `exclude.regexes` (as a long-running
// operation that is polled), populateFiles and uploads, PATCH, DELETE and the file list. `fetch` is the
// method the library is handed. It holds the API to what the tool relies on (the headers on every call,
// a hash that is the SHA-256 of the gzipped bytes, a version that can only be changed while CREATED and
// only released when FINALIZED) and counts what is written, so a test can say a call was or was not made.
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const BASE = 'https://firebasehosting.googleapis.com/v1beta1/';
const UPLOAD_HOST = 'https://upload-firebasehosting.googleapis.com/upload/';

export const hashOf = (content) => createHash('sha256').update(gzipSync(Buffer.from(content), { level: 9 })).digest('hex');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class FakeHosting {
  constructor({ site = 'games', project = 'proj-1', token = 'tok-secret' } = {}) {
    this.site = site;
    this.project = project;
    this.token = token;
    this.versions = new Map(); // id -> { name, status, files: Map(path -> hash), config }
    this.blobs = new Map(); // hash -> bytes: what the site has been sent
    this.channels = new Map(); // name -> { url, version }
    this.releases = []; // { channel, version, message }
    this.deleted = [];
    this.operations = new Map();
    this.calls = []; // { method, path, query, body }
    this.nextId = 1;
    this.pollsBeforeDone = 1;
    // Faults a test can set.
    this.cloneDrops = () => false; // a path the clone loses though it should keep it
    this.failUpload = () => undefined; // (hash, attempt) -> a status to fail with, 'network' to throw, or undefined
    this.onCall = () => {}; // (call) before a call is handled
    this.pageSize = 1000; // the file list's page, at most
    this.uploads = []; // hashes uploaded, in order
    this.uploadAttempts = new Map();
  }

  /** Makes a finalized version from `{ path: content }` and `config`; with `live` it is released to live. */
  seed(files, config = {}, { live = true } = {}) {
    const version = this.#newVersion(config);
    for (const [path, content] of Object.entries(files)) {
      const hash = hashOf(content);
      this.blobs.set(hash, Buffer.from(content));
      version.files.set(path, hash);
    }
    version.status = 'FINALIZED';
    if (live) this.#release('live', version);
    return version.name;
  }

  /** What another deploy does between this one's clone and its release: a new live version with one more file. */
  simulateOtherDeploy(path = '/other/new.html', content = 'new') {
    const live = this.liveVersion();
    const next = this.#newVersion(structuredClone(live.config));
    for (const [p, h] of live.files) next.files.set(p, h);
    const hash = hashOf(content);
    this.blobs.set(hash, Buffer.from(content));
    next.files.set(path, hash);
    next.status = 'FINALIZED';
    this.#release('live', next);
  }

  liveVersion() {
    const name = this.channels.get('live')?.version;
    return name ? this.versions.get(name.split('/').pop()) : undefined;
  }

  /** The live version's files as `{ path: hash }`. */
  liveFiles() {
    return Object.fromEntries(this.liveVersion()?.files ?? []);
  }

  /** A channel's version's files as `{ path: hash }`. */
  channelFiles(name) {
    return Object.fromEntries(this.versions.get(this.channels.get(name).version.split('/').pop()).files);
  }

  /** Calls that are not reads. */
  writes() {
    return this.calls.filter((c) => c.method !== 'GET');
  }

  #newVersion(config) {
    const id = String(this.nextId++);
    const version = { name: `sites/${this.site}/versions/${id}`, status: 'CREATED', files: new Map(), config };
    this.versions.set(id, version);
    return version;
  }

  #release(channel, version, message) {
    if (!this.channels.has(channel)) this.channels.set(channel, { url: `https://${this.site}.web.app`, version: undefined });
    this.channels.get(channel).version = version.name;
    this.releases.push({ channel, version: version.name, message });
  }

  #version(id) {
    const version = this.versions.get(id);
    if (!version) throw new HttpError(404, `version ${id} not found`);
    return version;
  }

  #describe(version) {
    return { name: version.name, status: version.status, fileCount: String(version.files.size), config: version.config };
  }

  fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const isUpload = url.href.startsWith(UPLOAD_HOST);
    const path = isUpload ? url.pathname.slice('/upload/'.length) : decodeURIComponent(url.href.slice(BASE.length).split('?')[0] ?? '');
    const call = { method, path, query: Object.fromEntries(url.searchParams), body: undefined };
    this.calls.push(call);
    try {
      if (headers.authorization !== `Bearer ${this.token}`) throw new HttpError(401, 'bad token');
      if (isUpload) {
        if (headers['content-type'] !== 'application/octet-stream') throw new HttpError(400, 'upload needs application/octet-stream');
      } else {
        if (headers['x-goog-user-project'] !== this.project) throw new HttpError(403, 'x-goog-user-project is not the project');
        if (headers['content-type'] !== 'application/json') throw new HttpError(400, 'content-type must be application/json');
        call.body = init.body === undefined ? undefined : JSON.parse(init.body);
      }
      await this.onCall(call);
      const result = isUpload ? this.#upload(path, init.body) : this.#route(method, path, call);
      return new Response(result === undefined ? '' : JSON.stringify(result), { status: 200 });
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.status === 'network') throw new TypeError('fetch failed');
        return new Response(JSON.stringify({ error: { code: error.status, message: error.message } }), { status: error.status });
      }
      throw error;
    }
  };

  #route(method, path, call) {
    const q = call.query;
    let m;
    const site = `sites/${this.site}`;
    if (method === 'GET' && path === `${site}/channels/live`) {
      const version = this.liveVersion();
      const channel = { name: `${site}/channels/live`, url: this.channels.get('live')?.url ?? `https://${this.site}.web.app` };
      return version ? { ...channel, release: { name: `${site}/releases/x`, version: this.#describe(version) } } : channel;
    }
    if (method === 'GET' && (m = path.match(new RegExp(`^${site}/channels/([^/]+)$`)))) {
      const channel = this.channels.get(m[1]);
      if (!channel) throw new HttpError(404, 'channel not found');
      return { name: path, url: channel.url };
    }
    if (method === 'POST' && path === `${site}/channels`) {
      const name = q.channelId;
      if (this.channels.has(name)) throw new HttpError(409, 'ALREADY_EXISTS');
      if (!/^\d+s$/.test(call.body?.ttl ?? '')) throw new HttpError(400, 'ttl must be seconds');
      this.channels.set(name, { url: `https://${this.site}--${name}-abc123.web.app`, version: undefined, ttl: call.body.ttl });
      return { name: `${site}/channels/${name}`, url: this.channels.get(name).url };
    }
    if (method === 'POST' && path === `${site}/versions:clone`) return this.#clone(call.body);
    if (method === 'GET' && (m = path.match(/^projects\/[^/]+\/operations\/(.+)$/))) return this.#operation(m[1], path);
    if (method === 'POST' && (m = path.match(new RegExp(`^${site}/versions/([^/]+):populateFiles$`)))) return this.#populate(this.#version(m[1]), call.body);
    if (method === 'PATCH' && (m = path.match(new RegExp(`^${site}/versions/([^/]+)$`)))) return this.#patch(this.#version(m[1]), q.update_mask, call.body);
    if (method === 'GET' && (m = path.match(new RegExp(`^${site}/versions/([^/]+)/files$`)))) return this.#files(this.#version(m[1]), q);
    if (method === 'DELETE' && (m = path.match(new RegExp(`^${site}/versions/([^/]+)$`)))) return this.#delete(this.#version(m[1]));
    if (method === 'POST' && path === `${site}/releases`) return this.#releaseCall('live', q.versionName, call.body?.message);
    if (method === 'POST' && (m = path.match(new RegExp(`^${site}/channels/([^/]+)/releases$`)))) {
      if (!this.channels.has(m[1])) throw new HttpError(404, 'channel not found');
      return this.#releaseCall(m[1], q.versionName, undefined);
    }
    throw new HttpError(404, `no route for ${method} ${path}`);
  }

  #clone(body) {
    if (body?.finalize !== false) throw new HttpError(400, 'the clone must be made with finalize false');
    const source = this.#version((body.sourceVersion ?? '').split('/').pop());
    const excludes = (body.exclude?.regexes ?? []).map((r) => new RegExp(r));
    const version = this.#newVersion(structuredClone(source.config));
    for (const [path, hash] of source.files) {
      if (excludes.some((re) => re.test(path)) || this.cloneDrops(path)) continue;
      version.files.set(path, hash);
    }
    const id = `op-${this.operations.size + 1}`;
    this.operations.set(id, { version, polls: 0 });
    return { name: `projects/${this.project}/operations/${id}` };
  }

  #operation(id, name) {
    const op = this.operations.get(id);
    if (!op) throw new HttpError(404, 'operation not found');
    if (op.polls++ < this.pollsBeforeDone) return { name, done: false };
    return { name, done: true, response: this.#describe(op.version) };
  }

  #populate(version, body) {
    if (version.status !== 'CREATED') throw new HttpError(400, 'the version is not CREATED');
    const files = Object.entries(body?.files ?? {});
    if (files.length > 1000) throw new HttpError(400, 'at most 1000 files in a populateFiles call');
    const need = new Set();
    for (const [path, hash] of files) {
      if (!path.startsWith('/')) throw new HttpError(400, `${path} must begin with /`);
      version.files.set(path, hash);
      if (!this.blobs.has(hash)) need.add(hash);
    }
    const answer = { uploadUrl: `${UPLOAD_HOST}${version.name}/files` };
    if (need.size > 0) answer.uploadRequiredHashes = [...need];
    return answer;
  }

  #upload(path, body) {
    const m = path.match(/^(sites\/[^/]+\/versions\/[^/]+)\/files\/([0-9a-f]{64})$/);
    if (!m) throw new HttpError(404, `no upload route for ${path}`);
    const hash = m[2];
    const attempt = (this.uploadAttempts.get(hash) ?? 0) + 1;
    this.uploadAttempts.set(hash, attempt);
    const fault = this.failUpload(hash, attempt);
    if (fault === 'network') throw new HttpError('network', 'connection reset');
    if (fault) throw new HttpError(fault, 'upload failed');
    const bytes = Buffer.from(body);
    if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new HttpError(400, 'the body is not the file of this hash');
    this.blobs.set(hash, bytes);
    this.uploads.push(hash);
    return undefined;
  }

  #patch(version, mask, body) {
    if (mask === 'config') {
      if (version.status !== 'CREATED') throw new HttpError(400, 'the version is not CREATED');
      version.config = body.config;
    } else if (mask === 'status') {
      if (body.status !== 'FINALIZED') throw new HttpError(400, 'only FINALIZED is allowed');
      for (const [path, hash] of version.files) {
        if (!this.blobs.has(hash)) throw new HttpError(400, `${path} has not been uploaded`);
      }
      version.status = 'FINALIZED';
    } else throw new HttpError(400, `update_mask ${mask}`);
    return this.#describe(version);
  }

  #files(version, q) {
    const size = Math.min(Number(q.pageSize ?? 1000), this.pageSize);
    const all = [...version.files].map(([path, hash]) => ({ path, hash, status: 'ACTIVE' }));
    const start = Number(q.pageToken ?? 0);
    const page = all.slice(start, start + size);
    return start + size < all.length ? { files: page, nextPageToken: String(start + size) } : { files: page };
  }

  #delete(version) {
    if ([...this.channels.values()].some((c) => c.version === version.name)) throw new HttpError(400, 'a released version cannot be deleted');
    this.versions.delete(version.name.split('/').pop());
    this.deleted.push(version.name);
    return {};
  }

  #releaseCall(channel, versionName, message) {
    const version = this.#version((versionName ?? '').split('/').pop());
    if (version.status !== 'FINALIZED') throw new HttpError(400, 'the version is not FINALIZED');
    this.#release(channel, version, message);
    return { name: `sites/${this.site}/releases/r${this.releases.length}`, version: this.#describe(version) };
  }
}
