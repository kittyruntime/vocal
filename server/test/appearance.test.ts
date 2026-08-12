import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import { makeTestDb } from "./helpers/db.js";
import { buildApp } from "../src/app.js";

let pool: pg.Pool;
let app: FastifyInstance;
let adminCookie: string;

beforeAll(async () => {
  pool = await makeTestDb();
  ({ app } = await buildApp({ pool }));
});
afterAll(async () => { await app.close(); await pool.end(); });

beforeEach(async () => {
  await pool.query("TRUNCATE users, sessions, invites, channels CASCADE");
  await pool.query(
    "UPDATE server_settings SET registration_open = true, enabled_accent_presets = ARRAY['amber', 'ember-red', 'magenta', 'glacier', 'emerald'], default_accent_preset = 'amber'",
  );
  const setup = await app.inject({ method: "POST", url: "/api/setup", payload: { username: "theo", password: "correct horse battery" } });
  adminCookie = `sid=${setup.cookies.find((cookie) => cookie.name === "sid")!.value}`;
});

async function registerAlice(): Promise<string> {
  const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "alice", password: "password123" } });
  return `sid=${reg.cookies.find((c) => c.name === "sid")!.value}`;
}

describe("appearance settings", () => {
  it("returns the default row (all 5 presets enabled, default amber) with no auth", async () => {
    const res = await app.inject({ method: "GET", url: "/api/appearance" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      enabledPresets: ["amber", "ember-red", "magenta", "glacier", "emerald"],
      defaultPreset: "amber",
    });
  });

  it("refuses to update appearance settings without manage_server", async () => {
    const aliceCookie = await registerAlice();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/admin/appearance",
      headers: { cookie: aliceCookie },
      payload: { defaultPreset: "glacier" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("updates enabledPresets and defaultPreset with manage_server capability", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/admin/appearance",
      headers: { cookie: adminCookie },
      payload: { enabledPresets: ["glacier", "emerald"], defaultPreset: "glacier" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabledPresets: ["glacier", "emerald"], defaultPreset: "glacier" });

    const get = await app.inject({ method: "GET", url: "/api/appearance" });
    expect(get.json()).toEqual({ enabledPresets: ["glacier", "emerald"], defaultPreset: "glacier" });
  });

  it("rejects a defaultPreset not present in the new enabledPresets list", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/admin/appearance",
      headers: { cookie: adminCookie },
      payload: { enabledPresets: ["glacier", "emerald"], defaultPreset: "amber" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an unknown preset id", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/admin/appearance",
      headers: { cookie: adminCookie },
      payload: { enabledPresets: ["not-a-real-preset"] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 for GET /api/me/accent without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me/accent" });
    expect(res.statusCode).toBe(401);
  });

  it("returns null accentPreset for a fresh user", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me/accent", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accentPreset: null });
  });

  it("sets a valid enabled preset and reflects it on GET", async () => {
    const patch = await app.inject({
      method: "PATCH",
      url: "/api/me/accent",
      headers: { cookie: adminCookie },
      payload: { accentPreset: "magenta" },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toEqual({ accentPreset: "magenta" });

    const get = await app.inject({ method: "GET", url: "/api/me/accent", headers: { cookie: adminCookie } });
    expect(get.json()).toEqual({ accentPreset: "magenta" });
  });

  it("rejects a preset that is not currently enabled", async () => {
    await app.inject({
      method: "PATCH",
      url: "/api/admin/appearance",
      headers: { cookie: adminCookie },
      payload: { enabledPresets: ["glacier", "emerald"], defaultPreset: "glacier" },
    });
    const res = await app.inject({
      method: "PATCH",
      url: "/api/me/accent",
      headers: { cookie: adminCookie },
      payload: { accentPreset: "amber" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("clears the user's override when accentPreset is null", async () => {
    await app.inject({ method: "PATCH", url: "/api/me/accent", headers: { cookie: adminCookie }, payload: { accentPreset: "emerald" } });
    const clear = await app.inject({ method: "PATCH", url: "/api/me/accent", headers: { cookie: adminCookie }, payload: { accentPreset: null } });
    expect(clear.statusCode).toBe(200);
    expect(clear.json()).toEqual({ accentPreset: null });

    const get = await app.inject({ method: "GET", url: "/api/me/accent", headers: { cookie: adminCookie } });
    expect(get.json()).toEqual({ accentPreset: null });
  });
});
