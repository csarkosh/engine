// A small Chrome DevTools Protocol client over one socket, with the flat sessions the browser's
// own targets (the page, its workers) are reached by. Plumbing only.

/**
 * Connects to a browser's debugging socket. Returns `send(method, params, sessionId)` resolving to
 * the result (rejecting on a protocol error, or if the browser goes away), `send.on(method, fn)`
 * for events (`fn(params, sessionId)`), and `send.close()`.
 */
export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const waiting = new Map();
  const listeners = new Map();
  let id = 0;
  let closed = false;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== undefined) waiting.get(m.id)?.(m);
    else if (m.method !== undefined) for (const fn of listeners.get(m.method) ?? []) fn(m.params, m.sessionId);
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error(`cannot connect to ${wsUrl}`));
  });
  ws.onclose = () => {
    closed = true;
    for (const done of [...waiting.values()]) done({ error: { message: "the browser closed the connection" } });
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      if (closed) { reject(new Error(`${method}: the browser closed the connection`)); return; }
      const n = ++id;
      waiting.set(n, (m) => {
        waiting.delete(n);
        if (m.error) reject(new Error(`${method}: ${m.error.message}`));
        else resolve(m.result);
      });
      ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  send.on = (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn]);
  send.close = () => ws.close();
  return send;
}

/** Races `promise` against `ms`; resolves to `fallback` if the time runs out first. */
export function within(promise, ms, fallback) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms, fallback))]);
}
