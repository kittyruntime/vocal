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

const messageQueues = new WeakMap<WebSocket, { queue: unknown[]; waiters: Array<(v: unknown) => void> }>();

// Deliberately not `ws.once("message", ...)`: the server can send two
// frames back-to-back with no real I/O gap between them (see ws/route.ts's
// hub.add -> presence.sync -> voice.sync sequence). When that happens,
// Node's `ws` client can deliver both frames within the same synchronous
// "message" emit burst, and a `.once()` listener re-armed via the next
// `await`'s microtask continuation isn't attached in time to catch the
// second frame — silently dropping it. This queues any message that
// arrives with no pending waiter, preserving delivery regardless of how
// frames were batched on the wire.
function nextMessage(ws: WebSocket): Promise<any> {
  let state = messageQueues.get(ws);
  if (!state) {
    state = { queue: [], waiters: [] };
    messageQueues.set(ws, state);
    ws.on("message", (data) => {
      const parsed: unknown = JSON.parse(data.toString());
      const waiter = state!.waiters.shift();
      if (waiter) waiter(parsed);
      else state!.queue.push(parsed);
    });
  }
  if (state.queue.length > 0) return Promise.resolve(state.queue.shift());
  return new Promise((resolve, reject) => {
    state!.waiters.push(resolve as (v: unknown) => void);
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
      participant: { identity: "some-user-id", name: "Alice" },
    });
    const res = await app.inject({ method: "POST", url: "/api/voice/webhook",
      headers: { "content-type": "application/json", authorization: await signWebhook(body) },
      payload: body });
    expect(res.statusCode).toBe(200);

    const event = await eventP;
    expect(event).toEqual({
      type: "voice.joined",
      channelId,
      participant: { userId: "some-user-id", username: "Alice" },
    });

    ws.close();
  });

  it("updates presence and broadcasts voice.left on participant_left", async () => {
    const ch = await app.inject({ method: "POST", url: "/api/channels",
      headers: { cookie: adminCookie }, payload: { name: "salle", type: "voice" } });
    const channelId = ch.json().id;

    const joinedBody = JSON.stringify({
      event: "participant_joined",
      room: { name: channelId },
      participant: { identity: "some-user-id", name: "Alice" },
    });
    await app.inject({ method: "POST", url: "/api/voice/webhook",
      headers: { "content-type": "application/json", authorization: await signWebhook(joinedBody) },
      payload: joinedBody });

    const ws = openWs(adminCookie);
    await new Promise((r) => ws.once("open", r));
    await nextMessage(ws); // presence.sync
    const voiceSync = await nextMessage(ws);
    expect(voiceSync.channels[channelId]).toEqual([{ userId: "some-user-id", username: "Alice" }]);

    const eventP = nextMessage(ws);
    const leftBody = JSON.stringify({
      event: "participant_left",
      room: { name: channelId },
      participant: { identity: "some-user-id", name: "Alice" },
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

  it("accepts the real LiveKit content-type (application/webhook+json)", async () => {
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
      headers: { "content-type": "application/webhook+json", authorization: await signWebhook(body) },
      payload: body });
    expect(res.statusCode).toBe(200);

    const event = await eventP;
    expect(event).toEqual({
      type: "voice.joined",
      channelId,
      participant: { userId: "some-user-id", username: "some-user-id" },
    });

    ws.close();
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
