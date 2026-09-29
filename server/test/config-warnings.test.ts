import { describe, it, expect } from "vitest";
import { productionConfigWarnings } from "../src/configWarnings.js";

const good = {
  NODE_ENV: "production",
  LIVEKIT_URL: "wss://livekit.example.com",
  LIVEKIT_API_KEY: "a1b2c3",
  LIVEKIT_API_SECRET: "d4e5f6",
};

describe("productionConfigWarnings", () => {
  it("is silent outside production", () => {
    expect(productionConfigWarnings({ ...good, NODE_ENV: "development", LIVEKIT_URL: "ws://localhost:7880",
      LIVEKIT_API_KEY: "devkey", LIVEKIT_API_SECRET: "secret", COOKIE_SECURE: "false" })).toEqual([]);
  });

  it("is silent for a sane production config", () => {
    expect(productionConfigWarnings(good)).toEqual([]);
  });

  it("flags a plain ws:// LiveKit URL", () => {
    const w = productionConfigWarnings({ ...good, LIVEKIT_URL: "ws://livekit.example.com" });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/ws:\/\//);
  });

  it("flags a loopback LiveKit URL", () => {
    const w = productionConfigWarnings({ ...good, LIVEKIT_URL: "wss://localhost:7880" });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/localhost/);
  });

  it("flags an unparseable LiveKit URL", () => {
    expect(productionConfigWarnings({ ...good, LIVEKIT_URL: "not a url" })[0]).toMatch(/not a valid URL/);
  });

  it("flags the dev LiveKit key pair", () => {
    const w = productionConfigWarnings({ ...good, LIVEKIT_API_KEY: "devkey", LIVEKIT_API_SECRET: "secret" });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/--dev defaults/);
  });

  it("flags insecure cookies", () => {
    expect(productionConfigWarnings({ ...good, COOKIE_SECURE: "false" })[0]).toMatch(/COOKIE_SECURE/);
  });
});
