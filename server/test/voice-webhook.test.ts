import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import { WebSocket } from "ws";
import { AccessToken } from "livekit-server-sdk";
import { createHash } from "node:crypto";
import { makeTestDb } from "./helpers/db.js";
import { buildApp } from "../src/app.js";

let pool: pg.Pool;
let app: FastifyInstance;
let baseUrl: string;
let adminCookie: string;

async function login(username: string, password: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/auth/login",
    payload: { username, password } });
  return `sid=${res.cookies.find((c) => c.name === "sid")!.value}`;
}

function openWs(cookie: string): WebSocket {
  return new WebSocket(`${baseUrl}/ws`, { headers: { cookie } });
}

function nextMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString())));
    ws.once("error", reject);
  });
}

// Mimics what a real LiveKit server sends: a JWT (signed with the shared
// API secret) carrying a `sha256` claim of the raw body, in the
// Authorization header.
async function signWebhook(body: string): Promise<string> {
  const at = new AccessToken("devkey", "secret", { ttl: "1m" });
  at.sha256 = createHash("sha256").update(body).digest("base64");
  return at.toJwt();
}

beforeAll(async () => {
  pool = await makeTestDb();
  ({ app } = await buildApp({ pool }));
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `ws://127.0.0.1:${port}`;
});
afterAll(async () => { await app.close(); await pool.end(); });

beforeEach(async () => {
  await pool.query("TRUNCATE users, sessions, invites, channels CASCADE");
  await app.inject({ method: "POST", url: "/api/setup",
    payload: { username: "theo", password: "correct horse battery" } });
  adminCookie = await login("theo", "correct horse battery");
});

describe("POST /api/voice/webhook", () => {
  it("rejects a request with an invalid signature", async () => {
    const body = JSON.stringify({ event: "participant_joined", room: { name: "x" }, participant: { identity: "y" } });
    const res = await app.inject({ method: "POST", url: "/api/voice/webhook",
      headers: { "content-type": "application/json", authorization: "not-a-valid-jwt" },
      payload: body });
    expect(res.statusCode).toBe(401);
  });

  it("updates presence and broadcasts voice.joined on participant_joined", async () => {
    const ch = await app.inject({ method: "POST", url: "/api/channels",
      headers: { cookie: adminCookie }, payload: { name: "salle", type: "voice" } });
    const channelId = ch.json().id;

    const ws = openWs(adminCookie);
    await new Promise((r) => ws.once("open", r));
    await nextMessage(ws); // presence.sync
    await nextMessage(ws); // voice.sync (empty)

    const eventP = nextMessage(ws);
    const body = JSON.stringify({
      event: "participant_joined",
      room: { name: channelId },
      participant: { identity: "some-user-id" },
    });
    const res = await app.inject({ method: "POST", url: "/api/voice/webhook",
      headers: { "content-type": "application/json", authorization: await signWebhook(body) },
      payload: body });
    expect(res.statusCode).toBe(200);

    const event = await eventP;
    expect(event).toEqual({ type: "voice.joined", channelId, userId: "some-user-id" });

    ws.close();
  });

  it("updates presence and broadcasts voice.left on participant_left", async () => {
    const ch = await app.inject({ method: "POST", url: "/api/channels",
      headers: { cookie: adminCookie }, payload: { name: "salle", type: "voice" } });
    const channelId = ch.json().id;

    const joinedBody = JSON.stringify({
      event: "participant_joined",
      room: { name: channelId },
      participant: { identity: "some-user-id" },
    });
    await app.inject({ method: "POST", url: "/api/voice/webhook",
      headers: { "content-type": "application/json", authorization: await signWebhook(joinedBody) },
      payload: joinedBody });

    const ws = openWs(adminCookie);
    await new Promise((r) => ws.once("open", r));
    await nextMessage(ws); // presence.sync
    const voiceSync = await nextMessage(ws);
    expect(voiceSync.channels[channelId]).toEqual(["some-user-id"]);

    const eventP = nextMessage(ws);
    const leftBody = JSON.stringify({
      event: "participant_left",
      room: { name: channelId },
      participant: { identity: "some-user-id" },
    });
    const res = await app.inject({ method: "POST", url: "/api/voice/webhook",
      headers: { "content-type": "application/json", authorization: await signWebhook(leftBody) },
      payload: leftBody });
    expect(res.statusCode).toBe(200);

    const event = await eventP;
    expect(event).toEqual({ type: "voice.left", channelId, userId: "some-user-id" });

    ws.close();
  });

  it("ignores webhook events for other event types without error", async () => {
    const body = JSON.stringify({ event: "room_started", room: { name: "whatever" } });
    const res = await app.inject({ method: "POST", url: "/api/voice/webhook",
      headers: { "content-type": "application/json", authorization: await signWebhook(body) },
      payload: body });
    expect(res.statusCode).toBe(200);
  });

  it("ignores a participant_joined for a channel that no longer exists", async () => {
    const body = JSON.stringify({
      event: "participant_joined",
      room: { name: "00000000-0000-0000-0000-000000000000" },
      participant: { identity: "some-user-id" },
    });
    const res = await app.inject({ method: "POST", url: "/api/voice/webhook",
      headers: { "content-type": "application/json", authorization: await signWebhook(body) },
      payload: body });
    expect(res.statusCode).toBe(200);
  });
});
