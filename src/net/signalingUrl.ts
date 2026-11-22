/**
 * Where the signaling server lives.
 *
 * Development and production differ: in development the Vite proxy puts
 * signaling on the page's own origin under `/ws`, while in production the
 * client is served from Firebase Hosting and signaling is a separate Cloud Run
 * origin. The override carries that second case; the fallback is the first.
 *
 * Takes `env` and `loc` as arguments rather than reading `import.meta.env` and
 * `location` directly so it stays a pure function — `net/` is Babylon-free and
 * headless-testable, and this keeps it that way.
 */
export function signalingUrl(
  env: { VITE_SIGNALING_URL?: string | undefined },
  loc: { protocol: string; host: string },
): string {
  // Empty counts as unset: a build variable that failed to substitute would
  // otherwise produce `new WebSocket("")`, which fails far from the cause.
  if (env.VITE_SIGNALING_URL) return env.VITE_SIGNALING_URL;
  const scheme = loc.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${loc.host}/ws`;
}

/**
 * Whether this build can reach a signaling server: development (the Vite proxy
 * answers on the page's own origin) or a build given an address. A production
 * build with none has no party: the game was published before it has a server.
 * Empty counts as unset, as `signalingUrl` treats it.
 */
export function hasSignaling(env: { DEV?: boolean; VITE_SIGNALING_URL?: string | undefined }): boolean {
  return env.DEV === true || Boolean(env.VITE_SIGNALING_URL);
}
