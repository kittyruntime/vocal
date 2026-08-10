import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import { TokenVerifier } from "livekit-server-sdk";
import { makeTestDb } from "./helpers/db.js";
import { buildApp } from "../src/app.js";

let pool: pg.Pool;
let app: FastifyInstance;
let adminCookie: string;

async function login(username: string, password: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/auth/login",
    payload: { username, password } });
  return `sid=${res.cookies.find((c) => c.name === "sid")!.value}`;
}

beforeAll(async () => {
  pool = await makeTestDb();
  ({ app } = await buildApp({ pool }));
});
afterAll(async () => { await app.close(); await pool.end(); });

beforeEach(async () => {
  await pool.query("TRUNCATE users, sessions, invites, channels CASCADE");
  await app.inject({ method: "POST", url: "/api/setup",
    payload: { username: "theo", password: "correct horse battery" } });
  adminCookie = await login("theo", "correct horse battery");
});

describe("POST /api/channels/:id/voice-token", () => {
  it("mints a short-lived LiveKit token scoped to the voice channel", async () => {
    const ch = await app.inject({ method: "POST", url: "/api/channels",
      headers: { cookie: adminCookie }, payload: { name: "salle", type: "voice" } });
    const channelId = ch.json().id;

    const res = await app.inject({ method: "POST", url: `/api/channels/${channelId}/voice-token`,
      headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(201);
    const { token, url } = res.json();
    expect(url).toBe("ws://localhost:7880");

    const verifier = new TokenVerifier("devkey", "secret");
    const claims = await verifier.verify(token);
    expect(claims.video?.room).toBe(channelId);
    expect(claims.video?.roomJoin).toBe(true);
    expect(claims.video?.canPublish).toBe(true);
    expect(claims.video?.canSubscribe).toBe(true);
    expect(claims.name).toBe("theo");
  });

  it("rejects a text channel", async () => {
    const ch = await app.inject({ method: "POST", url: "/api/channels",
      headers: { cookie: adminCookie }, payload: { name: "général", type: "text" } });
    const channelId = ch.json().id;
    const res = await app.inject({ method: "POST", url: `/api/channels/${channelId}/voice-token`,
      headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "not a voice channel" });
  });

  it("404s on an unknown channel", async () => {
    const res = await app.inject({ method: "POST",
      url: "/api/channels/00000000-0000-0000-0000-000000000000/voice-token",
      headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(404);
  });

  it("400s on a malformed channel id", async () => {
    const res = await app.inject({ method: "POST", url: "/api/channels/not-a-uuid/voice-token",
      headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(400);
  });

  it("forbids a member from joining a moderator-only voice channel", async () => {
    const ch = await app.inject({ method: "POST", url: "/api/channels",
      headers: { cookie: adminCookie },
      payload: { name: "staff-voice", type: "voice", minRole: "moderator" } });
    const channelId = ch.json().id;

    const inv = await app.inject({ method: "POST", url: "/api/invites", headers: { cookie: adminCookie } });
    const reg = await app.inject({ method: "POST", url: "/api/auth/register",
      payload: { inviteToken: inv.json().token, username: "alice", password: "alicepass123" } });
    const memberCookie = `sid=${reg.cookies.find((c) => c.name === "sid")!.value}`;

    const res = await app.inject({ method: "POST", url: `/api/channels/${channelId}/voice-token`,
      headers: { cookie: memberCookie } });
    expect(res.statusCode).toBe(403);
  });
});
