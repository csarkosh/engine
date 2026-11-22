import { describe, expect, it } from 'vitest';
import { ApiError, BASE, POLL_LIMIT, POLL_MS, createApi } from '../lib/api.mjs';

const TOKEN = 'tok-very-secret';
const reply = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

/** An api whose fetch answers from `answers` in turn; `seen` holds the calls. */
function apiWith(...answers) {
  const seen = [];
  const sleeps = [];
  const fetch = async (url, init) => {
    seen.push({ url, ...init });
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { api: createApi({ fetch, token: TOKEN, project: 'proj-1', sleep: async (ms) => void sleeps.push(ms) }), seen, sleeps };
}

describe('every call', () => {
  it('carries the bearer token, the quota project and a JSON content type, and an upload the token and octet-stream only', async () => {
    const { api, seen } = apiWith(reply(200, {}), reply(200, ''));
    await api.call('GET', 'sites/s/channels/live');
    await api.upload('https://upload-firebasehosting.googleapis.com/upload/sites/s/versions/1/files', 'ab', Buffer.from('x'));
    expect(seen[0].url).toBe(`${BASE}/sites/s/channels/live`);
    expect(seen[0].headers).toEqual({ authorization: `Bearer ${TOKEN}`, 'x-goog-user-project': 'proj-1', 'content-type': 'application/json' });
    expect(seen[1].url).toBe('https://upload-firebasehosting.googleapis.com/upload/sites/s/versions/1/files/ab');
    expect(seen[1].headers).toEqual({ authorization: `Bearer ${TOKEN}`, 'content-type': 'application/octet-stream' });
  });
});

describe('an error', () => {
  it('names the method and the path and holds the first 400 characters of the answer', async () => {
    const { api } = apiWith(reply(403, 'x'.repeat(1000)));
    const error = await api.call('POST', 'sites/s/releases?versionName=v').catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe(`POST /v1beta1/sites/s/releases?versionName=v: HTTP 403: ${'x'.repeat(400)}`);
    expect(error.status).toBe(403);
    expect(error.retryable).toBe(false);
  });
  it('never carries the token, in the answer or in a network error', async () => {
    const { api } = apiWith(reply(401, `bad token ${TOKEN}`), new TypeError(`connect failed for ${TOKEN}`));
    expect((await api.call('GET', 'x').catch((e) => e)).message).not.toContain(TOKEN);
    const network = await api.call('GET', 'x').catch((e) => e);
    expect(network.message).not.toContain(TOKEN);
    expect(network).toMatchObject({ status: 0, retryable: true });
  });
  it('is retryable for a 5xx and not for a 4xx', async () => {
    const { api } = apiWith(reply(503, 'busy'), reply(429, 'slow'));
    expect((await api.call('GET', 'x').catch((e) => e)).retryable).toBe(true);
    expect((await api.call('GET', 'x').catch((e) => e)).retryable).toBe(false);
  });
});

describe('getLive', () => {
  it('answers the live version, or null when there is no release or no channel', async () => {
    expect((await apiWith(reply(200, { release: { version: { name: 'sites/s/versions/1' } } })).api.getLive('s')).name).toBe('sites/s/versions/1');
    expect(await apiWith(reply(200, { name: 'sites/s/channels/live' })).api.getLive('s')).toBeNull();
    expect(await apiWith(reply(404, 'none')).api.getLive('s')).toBeNull();
    await expect(apiWith(reply(500, 'down')).api.getLive('s')).rejects.toThrow(/HTTP 500/);
  });
});

describe('listFiles', () => {
  it('follows the page tokens', async () => {
    const { api, seen } = apiWith(reply(200, { files: [{ path: '/a', hash: '1' }], nextPageToken: 'n 2' }), reply(200, { files: [{ path: '/b', hash: '2' }] }));
    expect(await api.listFiles('sites/s/versions/1')).toEqual([{ path: '/a', hash: '1' }, { path: '/b', hash: '2' }]);
    expect(seen[0].url).toBe(`${BASE}/sites/s/versions/1/files?pageSize=1000`);
    expect(seen[1].url).toBe(`${BASE}/sites/s/versions/1/files?pageSize=1000&pageToken=n%202`);
  });
});

describe('clone', () => {
  const op = { name: 'projects/1/operations/o' };
  it('asks for the clone not finalized and without the regexes, and polls every 1.5 s until done', async () => {
    const { api, seen, sleeps } = apiWith(reply(200, op), reply(200, { done: false }), reply(200, { done: false }), reply(200, { done: true, response: { name: 'sites/s/versions/2', status: 'CREATED' } }));
    const version = await api.clone('s', 'sites/s/versions/1', ['^/g/.*$']);
    expect(version.name).toBe('sites/s/versions/2');
    expect(JSON.parse(seen[0].body)).toEqual({ sourceVersion: 'sites/s/versions/1', finalize: false, exclude: { regexes: ['^/g/.*$'] } });
    expect(seen[1].url).toBe(`${BASE}/projects/1/operations/o`);
    expect(sleeps).toEqual([POLL_MS, POLL_MS]);
    expect(POLL_MS).toBe(1500);
  });
  it('fails on an operation that carries an error, and one that does not finish in three minutes', async () => {
    await expect(apiWith(reply(200, op), reply(200, { done: true, error: { code: 9, message: 'no' } })).api.clone('s', 'v', [])).rejects.toThrow(/the clone failed: .*"no"/);
    const never = Array.from({ length: POLL_LIMIT }, () => reply(200, { done: false }));
    const { api, sleeps } = apiWith(reply(200, op), ...never);
    await expect(api.clone('s', 'v', [])).rejects.toThrow(/not done after 3 minutes/);
    expect(sleeps).toHaveLength(POLL_LIMIT);
    expect(POLL_LIMIT * POLL_MS).toBe(180000);
  });
});

describe('populateFiles', () => {
  it('answers the hashes to upload, none when the answer has none', async () => {
    expect(await apiWith(reply(200, { uploadRequiredHashes: ['a'], uploadUrl: 'https://u' })).api.populateFiles('v', { '/a': 'a' })).toEqual({ hashes: ['a'], uploadUrl: 'https://u' });
    expect((await apiWith(reply(200, { uploadUrl: 'https://u' })).api.populateFiles('v', {})).hashes).toEqual([]);
  });
});

describe('upload', () => {
  it('is tried again twice on a 5xx or a network error, and then given up', async () => {
    const ok = apiWith(reply(503, 'a'), new TypeError('reset'), reply(200, ''));
    await ok.api.upload('https://u', 'h', Buffer.from('x'));
    expect(ok.seen).toHaveLength(3);
    expect(ok.sleeps).toHaveLength(2);
    const bad = apiWith(reply(500, 'a'), reply(502, 'b'), reply(503, 'c'), reply(200, ''));
    await expect(bad.api.upload('https://u', 'h', Buffer.from('x'))).rejects.toThrow(/HTTP 503/);
    expect(bad.seen).toHaveLength(3);
  });
  it('is not tried again on a 4xx', async () => {
    const bad = apiWith(reply(400, 'bad'), reply(200, ''));
    await expect(bad.api.upload('https://u', 'h', Buffer.from('x'))).rejects.toThrow(/HTTP 400/);
    expect(bad.seen).toHaveLength(1);
  });
});

describe('ensureChannel', () => {
  it('makes the channel with its life in seconds, or reads the one that exists', async () => {
    const made = apiWith(reply(200, { url: 'https://s--c.web.app' }));
    expect(await made.api.ensureChannel('s', 'c', 7)).toBe('https://s--c.web.app');
    expect(made.seen[0].url).toBe(`${BASE}/sites/s/channels?channelId=c`);
    expect(JSON.parse(made.seen[0].body)).toEqual({ ttl: '604800s' });
    const had = apiWith(reply(409, { error: { status: 'ALREADY_EXISTS' } }), reply(200, { url: 'https://s--c-old.web.app' }));
    expect(await had.api.ensureChannel('s', 'c', 7)).toBe('https://s--c-old.web.app');
    expect(had.seen[1].url).toBe(`${BASE}/sites/s/channels/c`);
    await expect(apiWith(reply(403, 'no')).api.ensureChannel('s', 'c', 7)).rejects.toThrow(/HTTP 403/);
  });
});
