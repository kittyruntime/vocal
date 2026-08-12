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
  await pool.query("UPDATE server_settings SET registration_open = true");
  await pool.query("UPDATE server_sounds SET enabled = true, audio_data = NULL");
  const setup = await app.inject({ method: "POST", url: "/api/setup", payload: { username: "theo", password: "correct horse battery" } });
  adminCookie = `sid=${setup.cookies.find((cookie) => cookie.name === "sid")!.value}`;
});

async function registerAlice(): Promise<string> {
  const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "alice", password: "password123" } });
  return `sid=${reg.cookies.find((c) => c.name === "sid")!.value}`;
}

describe("sound settings", () => {
  it("returns default settings for every event to any authenticated user", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sounds", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      message: { enabled: true, hasCustom: false },
      userJoin: { enabled: true, hasCustom: false },
      userLeave: { enabled: true, hasCustom: false },
      muteToggle: { enabled: true, hasCustom: false },
      forceMuted: { enabled: true, hasCustom: false },
      screenShare: { enabled: true, hasCustom: false },
    });
  });

  it("refuses to change a sound without manage_server", async () => {
    const aliceCookie = await registerAlice();
    const res = await app.inject({ method: "PATCH", url: "/api/admin/sounds/message", headers: { cookie: aliceCookie }, payload: { enabled: false } });
    expect(res.statusCode).toBe(403);
  });

  it("toggles a sound's enabled state", async () => {
    const patch = await app.inject({ method: "PATCH", url: "/api/admin/sounds/message", headers: { cookie: adminCookie }, payload: { enabled: false } });
    expect(patch.json()).toEqual({ enabled: false, hasCustom: false });
    const get = await app.inject({ method: "GET", url: "/api/sounds", headers: { cookie: adminCookie } });
    expect(get.json().message).toEqual({ enabled: false, hasCustom: false });
  });

  it("rejects an invalid audioData payload", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/admin/sounds/message", headers: { cookie: adminCookie }, payload: { audioData: "not-a-data-url" } });
    expect(res.statusCode).toBe(400);
  });

  it("rejects audioData over the size cap", async () => {
    const huge = `data:audio/mpeg;base64,${Buffer.alloc(6_000_000, 1).toString("base64")}`;
    const res = await app.inject({ method: "PATCH", url: "/api/admin/sounds/message", headers: { cookie: adminCookie }, payload: { audioData: huge } });
    expect(res.statusCode).toBe(400);
  });

  it("uploads a custom sound and serves it back", async () => {
    const audioData = `data:audio/mpeg;base64,${Buffer.from("fake mp3 bytes").toString("base64")}`;
    const patch = await app.inject({ method: "PATCH", url: "/api/admin/sounds/message", headers: { cookie: adminCookie }, payload: { audioData } });
    expect(patch.json()).toEqual({ enabled: true, hasCustom: true });
    const file = await app.inject({ method: "GET", url: "/api/sounds/message/file", headers: { cookie: adminCookie } });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("audio/mpeg");
    expect(file.rawPayload.toString()).toBe("fake mp3 bytes");
  });

  it("resets a sound to default via audioData: null", async () => {
    const audioData = `data:audio/mpeg;base64,${Buffer.from("fake mp3 bytes").toString("base64")}`;
    await app.inject({ method: "PATCH", url: "/api/admin/sounds/message", headers: { cookie: adminCookie }, payload: { audioData } });
    const reset = await app.inject({ method: "PATCH", url: "/api/admin/sounds/message", headers: { cookie: adminCookie }, payload: { audioData: null } });
    expect(reset.json()).toEqual({ enabled: true, hasCustom: false });
    const file = await app.inject({ method: "GET", url: "/api/sounds/message/file", headers: { cookie: adminCookie } });
    expect(file.statusCode).toBe(404);
  });

  it("404s the file route for an event without a custom upload", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sounds/userJoin/file", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(404);
  });

  it("serves an ETag and honors If-None-Match with a 304", async () => {
    const audioData = `data:audio/mpeg;base64,${Buffer.from("fake mp3 bytes").toString("base64")}`;
    await app.inject({ method: "PATCH", url: "/api/admin/sounds/message", headers: { cookie: adminCookie }, payload: { audioData } });

    const first = await app.inject({ method: "GET", url: "/api/sounds/message/file", headers: { cookie: adminCookie } });
    expect(first.statusCode).toBe(200);
    const etag = first.headers["etag"];
    expect(etag).toBeTruthy();

    const revalidated = await app.inject({ method: "GET", url: "/api/sounds/message/file", headers: { cookie: adminCookie, "if-none-match": etag as string } });
    expect(revalidated.statusCode).toBe(304);
    expect(revalidated.rawPayload.toString()).toBe("");

    const stale = await app.inject({ method: "GET", url: "/api/sounds/message/file", headers: { cookie: adminCookie, "if-none-match": '"stale-etag"' } });
    expect(stale.statusCode).toBe(200);
    expect(stale.rawPayload.toString()).toBe("fake mp3 bytes");
  });

  it("uploads and serves back a non-mpeg custom sound", async () => {
    const audioData = `data:audio/ogg;base64,${Buffer.from("fake ogg bytes").toString("base64")}`;
    const patch = await app.inject({ method: "PATCH", url: "/api/admin/sounds/message", headers: { cookie: adminCookie }, payload: { audioData } });
    expect(patch.json()).toEqual({ enabled: true, hasCustom: true });
    const file = await app.inject({ method: "GET", url: "/api/sounds/message/file", headers: { cookie: adminCookie } });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("audio/ogg");
    expect(file.rawPayload.toString()).toBe("fake ogg bytes");
  });

  it("returns default volumes for a fresh user", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me/sound-volumes", headers: { cookie: adminCookie } });
    expect(res.json()).toEqual({ message: 55, userJoin: 55, userLeave: 55, muteToggle: 55, forceMuted: 55, screenShare: 55 });
  });

  it("updates a single volume without affecting the others", async () => {
    await app.inject({ method: "PATCH", url: "/api/me/sound-volumes", headers: { cookie: adminCookie }, payload: { event: "message", volume: 80 } });
    const second = await app.inject({ method: "PATCH", url: "/api/me/sound-volumes", headers: { cookie: adminCookie }, payload: { event: "userJoin", volume: 10 } });
    expect(second.json()).toEqual({ message: 80, userJoin: 10, userLeave: 55, muteToggle: 55, forceMuted: 55, screenShare: 55 });
  });

  it("rejects an out-of-range volume", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/me/sound-volumes", headers: { cookie: adminCookie }, payload: { event: "message", volume: 150 } });
    expect(res.statusCode).toBe(400);
  });

  it("lets each user upload, serve, and reset a personal sound", async () => {
    const aliceCookie = await registerAlice();
    const audioData = `data:audio/mpeg;base64,${Buffer.from("alice sound").toString("base64")}`;
    const upload = await app.inject({ method: "PATCH", url: "/api/me/sounds/userJoin", headers: { cookie: aliceCookie }, payload: { audioData } });
    expect(upload.json()).toEqual({ hasCustom: true });

    const settings = await app.inject({ method: "GET", url: "/api/me/sounds", headers: { cookie: aliceCookie } });
    expect(settings.json().userJoin).toEqual({ hasCustom: true });
    expect(settings.json().message).toEqual({ hasCustom: false });

    const file = await app.inject({ method: "GET", url: "/api/me/sounds/userJoin/file", headers: { cookie: aliceCookie } });
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.toString()).toBe("alice sound");

    const adminFile = await app.inject({ method: "GET", url: "/api/me/sounds/userJoin/file", headers: { cookie: adminCookie } });
    expect(adminFile.statusCode).toBe(404);

    const reset = await app.inject({ method: "PATCH", url: "/api/me/sounds/userJoin", headers: { cookie: aliceCookie }, payload: { audioData: null } });
    expect(reset.json()).toEqual({ hasCustom: false });
    const afterReset = await app.inject({ method: "GET", url: "/api/me/sounds/userJoin/file", headers: { cookie: aliceCookie } });
    expect(afterReset.statusCode).toBe(404);
  });

  it("validates personal sound uploads with the same rules as server sounds", async () => {
    const invalid = await app.inject({ method: "PATCH", url: "/api/me/sounds/message", headers: { cookie: adminCookie }, payload: { audioData: "invalid" } });
    expect(invalid.statusCode).toBe(400);
  });
});
