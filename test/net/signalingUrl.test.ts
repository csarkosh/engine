import { describe, it, expect } from "vitest";
import { hasSignaling, signalingUrl } from "../../src/net/signalingUrl.js";

describe("signalingUrl", () => {
  it("prefers the configured override", () => {
    expect(
      signalingUrl(
        { VITE_SIGNALING_URL: "wss://fps-signaling-abc-uw.a.run.app/ws" },
        { protocol: "https:", host: "game.csarko.sh" },
      ),
    ).toBe("wss://fps-signaling-abc-uw.a.run.app/ws");
  });

  it("falls back to same-origin wss under https", () => {
    expect(signalingUrl({}, { protocol: "https:", host: "game.csarko.sh" })).toBe(
      "wss://game.csarko.sh/ws",
    );
  });

  it("falls back to same-origin ws under http, so dev keeps working", () => {
    expect(signalingUrl({}, { protocol: "http:", host: "localhost:5173" })).toBe(
      "ws://localhost:5173/ws",
    );
  });

  it("treats an empty override as unset", () => {
    // An unsubstituted build variable must not become new WebSocket("").
    expect(
      signalingUrl({ VITE_SIGNALING_URL: "" }, { protocol: "http:", host: "localhost:5173" }),
    ).toBe("ws://localhost:5173/ws");
  });
});

describe("hasSignaling", () => {
  it("is true in development, with or without an address", () => {
    expect(hasSignaling({ DEV: true })).toBe(true);
    expect(hasSignaling({ DEV: true, VITE_SIGNALING_URL: undefined })).toBe(true);
    expect(hasSignaling({ DEV: true, VITE_SIGNALING_URL: "" })).toBe(true);
  });

  it("is true in a build given an address", () => {
    expect(hasSignaling({ DEV: false, VITE_SIGNALING_URL: "wss://example.invalid/ws" })).toBe(true);
    expect(hasSignaling({ VITE_SIGNALING_URL: "wss://example.invalid/ws" })).toBe(true);
  });

  it("is false in a production build with no address, and an empty one counts as none", () => {
    expect(hasSignaling({ DEV: false })).toBe(false);
    expect(hasSignaling({})).toBe(false);
    expect(hasSignaling({ DEV: false, VITE_SIGNALING_URL: undefined })).toBe(false);
    expect(hasSignaling({ DEV: false, VITE_SIGNALING_URL: "" })).toBe(false);
  });
});
