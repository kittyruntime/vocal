import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import { WebSocket } from "ws";
import { makeTestDb } from "./helpers/db.js";
import { buildApp } from "../src/app.js";
import { createSession } from "../src/auth/sessions.js";
import type { VoicePresence } from "../src/voice/presence.js";

let pool: pg.Pool;
let app: FastifyInstance;
let voicePresence: VoicePresence;
let baseUrl: string;
let adminCookie: string;

async function loginCookie(username: string, password: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/auth/login",
    payload: { username, password } });
  return `sid=${res.cookies.find((c) => c.name === "sid")!.value}`;
}

function openWs(cookie?: string): WebSocket {
  return new WebSocket(`${baseUrl}/ws`, cookie ? { headers: { cookie } } : {});
}

function openWsWithHeaders(headers: Record<string, string>): WebSocket {
  return new WebSocket(`${baseUrl}/ws`, { headers });
}

const messageQueues = new WeakMap<WebSocket, { queue: unknown[]; waiters: Array<(v: unknown) => void> }>();

// Deliberately not `ws.once("message", ...)`: the server (see ws/route.ts's
// hub.add -> presence.sync -> voice.sync sequence) can send two frames
// back-to-back with no real I/O gap between them. When that happens, Node's
// `ws` client can deliver both frames within the same synchronous "message"
// emit burst. A `.once()` listener re-armed via the next `await`'s microtask
// continuation isn't attached in time to catch the second frame, so it's
// silently dropped — not a server bug, but a test-harness race. This queues
// any message that arrives with no pending waiter, so delivery order is
// preserved no matter how the frames were batched on the wire.
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

function closed(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.once("close", (code) => resolve(code)));
}

beforeAll(async () => {
  pool = await makeTestDb();
  ({ app, voicePresence } = await buildApp({ pool }));
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `ws://127.0.0.1:${port}`;
});
afterAll(async () => { await app.close(); await pool.end(); });

beforeEach(async () => {
  await pool.query("TRUNCATE users, sessions, invites, channels CASCADE");
  const setup = await app.inject({ method: "POST", url: "/api/setup",
    payload: { username: "theo", password: "correct horse battery" } });
  adminCookie = `sid=${setup.cookies.find((c) => c.name === "sid")!.value}`;
});

describe("websocket", () => {
  it("rejects an unauthenticated connection", async () => {
    const ws = openWs();
    const code = await closed(ws);
    expect(code).toBe(1008);
  });

  it("rejects a cross-origin handshake even with a valid cookie (CSWSH)", async () => {
    const ws = openWsWithHeaders({ cookie: adminCookie, origin: "https://evil.example" });
    const code = await closed(ws);
    expect(code).toBe(1008);
  });

  it("accepts a same-origin handshake", async () => {
    const origin = baseUrl.replace(/^ws:/, "http:");
    const ws = openWsWithHeaders({ cookie: adminCookie, origin });
    await new Promise((r) => ws.once("open", r));
    const sync = await nextMessage(ws);
    expect(sync.type).toBe("presence.sync");
    ws.close();
    await closed(ws);
  });

  it("accepts a ?token= handshake from a foreign origin (desktop client) since it carries no ambient credential", async () => {
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: adminCookie } });
    const { token } = await createSession(pool, me.json().id);
    const ws = new WebSocket(`${baseUrl}/ws?token=${token}`, { headers: { origin: "https://not-the-server.example" } });
    await new Promise((r) => ws.once("open", r));
    const sync = await nextMessage(ws);
    expect(sync.type).toBe("presence.sync");
    ws.close();
    await closed(ws);
  });

  it("rejects a ?token= handshake with an invalid token", async () => {
    const ws = new WebSocket(`${baseUrl}/ws?token=not-a-real-token`);
    const code = await closed(ws);
    expect(code).toBe(1008);
  });

  it("sends presence.sync on connect and answers ping with pong", async () => {
    const cookie = await loginCookie("theo", "correct horse battery");
    const ws = openWs(cookie);
    await new Promise((r) => ws.once("open", r));
    const sync = await nextMessage(ws);
    expect(sync.type).toBe("presence.sync");
    expect(Array.isArray(sync.userIds)).toBe(true);
    await nextMessage(ws); // voice.sync
    ws.send(JSON.stringify({ type: "ping" }));
    const pong = await nextMessage(ws);
    expect(pong).toEqual({ type: "pong" });
    ws.close();
    await closed(ws);
  });

  it("sends voice.sync on connect, filtered to channels the user's capabilities can see", async () => {
    const adminCookie = await loginCookie("theo", "correct horse battery");

    const publicVoice = await app.inject({ method: "POST", url: "/api/channels",
      headers: { cookie: adminCookie }, payload: { name: "salle", type: "voice" } });
    const publicId = publicVoice.json().id;

    const staffVoice = await app.inject({ method: "POST", url: "/api/channels",
      headers: { cookie: adminCookie },
      payload: { name: "staff-voice", type: "voice", requiredCapability: "moderate" } });
    const staffId = staffVoice.json().id;

    // Populate real occupancy directly via the presence tracker — this is
    // the same interface Task 4's webhook will call, just invoked here
    // without a real LiveKit round-trip.
    voicePresence.join(publicId, { userId: "occupant-1", username: "Alice" });
    voicePresence.join(staffId, { userId: "occupant-2", username: "Bob" });

    // A plain member: sees the public channel's occupant, but the
    // moderator-only channel's occupant must not leak through.
    const invA = await app.inject({ method: "POST", url: "/api/invites", headers: { cookie: adminCookie } });
    const regA = await app.inject({ method: "POST", url: "/api/auth/register",
      payload: { inviteToken: invA.json().token, username: "alice", password: "alicepass123" } });
    const memberCookie = `sid=${regA.cookies.find((c) => c.name === "sid")!.value}`;

    const wsMember = openWs(memberCookie);
    await new Promise((r) => wsMember.once("open", r));
    await nextMessage(wsMember); // presence.sync
    const memberVoiceSync = await nextMessage(wsMember);
    expect(memberVoiceSync.type).toBe("voice.sync");
    expect(memberVoiceSync.channels[publicId]).toEqual([{ userId: "occupant-1", username: "Alice" }]);
    expect(memberVoiceSync.channels[staffId]).toBeUndefined();

    // A moderator: sees both channels' occupants, proving the filter
    // allows access (not just excludes it) when the capability is held.
    const invB = await app.inject({ method: "POST", url: "/api/invites", headers: { cookie: adminCookie } });
    const regB = await app.inject({ method: "POST", url: "/api/auth/register",
      payload: { inviteToken: invB.json().token, username: "bob", password: "bobpass1234" } });
    const bobId = (await app.inject({ method: "GET", url: "/api/me",
      headers: { cookie: `sid=${regB.cookies.find((c) => c.name === "sid")!.value}` } })).json().id;
    await app.inject({ method: "PATCH", url: `/api/admin/users/${bobId}`,
      headers: { cookie: adminCookie }, payload: { capabilities: ["moderate"] } });
    const modCookie = `sid=${regB.cookies.find((c) => c.name === "sid")!.value}`;

    const wsMod = openWs(modCookie);
    await new Promise((r) => wsMod.once("open", r));
    await nextMessage(wsMod); // presence.sync
    const modVoiceSync = await nextMessage(wsMod);
    expect(modVoiceSync.type).toBe("voice.sync");
    expect(modVoiceSync.channels[publicId]).toEqual([{ userId: "occupant-1", username: "Alice" }]);
    expect(modVoiceSync.channels[staffId]).toEqual([{ userId: "occupant-2", username: "Bob" }]);

    wsMember.close();
    wsMod.close();
    await Promise.all([closed(wsMember), closed(wsMod)]);
  });

  it("ignores non-object JSON payloads instead of crashing", async () => {
    const cookie = await loginCookie("theo", "correct horse battery");
    const ws = openWs(cookie);
    await new Promise((r) => ws.once("open", r));
    const sync = await nextMessage(ws);
    expect(sync.type).toBe("presence.sync");
    await nextMessage(ws); // voice.sync

    ws.send("null");
    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.send(JSON.stringify({ type: "ping" }));
    const pong = await nextMessage(ws);
    expect(pong).toEqual({ type: "pong" });
    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
    await closed(ws);
  });

  it("broadcasts presence.online / presence.offline across clients", async () => {
    const cookieA = await loginCookie("theo", "correct horse battery");
    const wsA = openWs(cookieA);
    await new Promise((r) => wsA.once("open", r));
    await nextMessage(wsA); // presence.sync
    await nextMessage(wsA); // voice.sync

    // second user
    const inv = await app.inject({ method: "POST", url: "/api/invites",
      headers: { cookie: cookieA } });
    await app.inject({ method: "POST", url: "/api/auth/register",
      payload: { inviteToken: inv.json().token, username: "alice", password: "alicepass123" } });
    const cookieB = await loginCookie("alice", "alicepass123");

    const onlineP = nextMessage(wsA);
    const wsB = openWs(cookieB);
    await new Promise((r) => wsB.once("open", r));
    const online = await onlineP;
    expect(online.type).toBe("presence.online");

    const offlineP = nextMessage(wsA);
    wsB.close();
    const offline = await offlineP;
    expect(offline.type).toBe("presence.offline");

    wsA.close();
    await closed(wsA);
  });

  it("broadcasts message.created to a connected client", async () => {
    const cookie = await loginCookie("theo", "correct horse battery");

    // Create the channel before opening the WS so we don't have to skip a
    // channel.created event before the message.created we care about.
    const ch = await app.inject({ method: "POST", url: "/api/channels",
      headers: { cookie }, payload: { name: "général", type: "text" } });
    const channelId = ch.json().id;

    const ws = openWs(cookie);
    await new Promise((r) => ws.once("open", r));
    await nextMessage(ws); // presence.sync
    await nextMessage(ws); // voice.sync

    const eventP = nextMessage(ws);
    const res = await app.inject({ method: "POST", url: `/api/channels/${channelId}/messages`,
      headers: { cookie }, payload: { content: "salut 👋" } });
    expect(res.statusCode).toBe(201);

    const event = await eventP;
    expect(event.type).toBe("message.created");
    expect(event.message).toMatchObject({
      content: "salut 👋", channelId, username: "theo",
    });

    ws.close();
    await closed(ws);
  });

  it("broadcasts channel.created to a connected client", async () => {
    const cookie = await loginCookie("theo", "correct horse battery");
    const ws = openWs(cookie);
    await new Promise((r) => ws.once("open", r));
    await nextMessage(ws); // presence.sync
    await nextMessage(ws); // voice.sync

    const eventP = nextMessage(ws);
    const res = await app.inject({ method: "POST", url: "/api/channels",
      headers: { cookie }, payload: { name: "annonces", type: "text" } });
    expect(res.statusCode).toBe(201);

    const event = await eventP;
    expect(event.type).toBe("channel.created");
    expect(event.channel).toMatchObject({ name: "annonces", type: "text" });
    expect(typeof event.channel.createdAt).toBe("string");

    ws.close();
    await closed(ws);
  });

  it("scopes message.created to the channel's required capability: a non-holder is excluded, holders are included", async () => {
    const adminCookie = await loginCookie("theo", "correct horse battery");

    const staff = await app.inject({ method: "POST", url: "/api/channels",
      headers: { cookie: adminCookie }, payload: { name: "staff", type: "text", requiredCapability: "moderate" } });
    const staffId = staff.json().id;
    const general = await app.inject({ method: "POST", url: "/api/channels",
      headers: { cookie: adminCookie }, payload: { name: "général", type: "text" } });
    const generalId = general.json().id;

    // Use the session cookie register() already sets, rather than a second
    // /api/auth/login call — /api/auth/login is rate-limited and the test
    // suite's total call count is close to that limit. Capabilities are
    // looked up live per-request (not cached in the session), so granting
    // bob 'moderate' after registering still takes effect on his existing
    // cookie.
    const invA = await app.inject({ method: "POST", url: "/api/invites", headers: { cookie: adminCookie } });
    const regA = await app.inject({ method: "POST", url: "/api/auth/register",
      payload: { inviteToken: invA.json().token, username: "alice", password: "alicepass123" } });
    const memberCookie = `sid=${regA.cookies.find((c) => c.name === "sid")!.value}`;

    const invB = await app.inject({ method: "POST", url: "/api/invites", headers: { cookie: adminCookie } });
    const regB = await app.inject({ method: "POST", url: "/api/auth/register",
      payload: { inviteToken: invB.json().token, username: "bob", password: "bobpass1234" } });
    const bobId = (await app.inject({ method: "GET", url: "/api/me",
      headers: { cookie: `sid=${regB.cookies.find((c) => c.name === "sid")!.value}` } })).json().id;
    await app.inject({ method: "PATCH", url: `/api/admin/users/${bobId}`,
      headers: { cookie: adminCookie }, payload: { capabilities: ["moderate"] } });
    const modCookie = `sid=${regB.cookies.find((c) => c.name === "sid")!.value}`;

    // Connect one socket at a time, draining both its own presence.sync /
    // voice.sync snapshot and the presence.online broadcast each new
    // connection fans out to every already-connected socket (nextMessage
    // queues messages, so these must be explicitly drained rather than
    // relying on them arriving with no listener attached).
    const wsAdmin = openWs(adminCookie);
    await new Promise((r) => wsAdmin.once("open", r));
    await nextMessage(wsAdmin); // presence.sync
    await nextMessage(wsAdmin); // voice.sync

    const wsMod = openWs(modCookie);
    await new Promise((r) => wsMod.once("open", r));
    await nextMessage(wsAdmin); // presence.online (bob connects)
    await nextMessage(wsMod); // presence.sync
    await nextMessage(wsMod); // voice.sync

    const wsMember = openWs(memberCookie);
    await new Promise((r) => wsMember.once("open", r));
    await nextMessage(wsAdmin); // presence.online (alice connects)
    await nextMessage(wsMod); // presence.online (alice connects)
    await nextMessage(wsMember); // presence.sync
    await nextMessage(wsMember); // voice.sync

    const adminEventP = nextMessage(wsAdmin);
    const modEventP = nextMessage(wsMod);
    const memberEventP = nextMessage(wsMember);

    const staffRes = await app.inject({ method: "POST", url: `/api/channels/${staffId}/messages`,
      headers: { cookie: adminCookie }, payload: { content: "top secret" } });
    expect(staffRes.statusCode).toBe(201);

    const generalRes = await app.inject({ method: "POST", url: `/api/channels/${generalId}/messages`,
      headers: { cookie: adminCookie }, payload: { content: "public hello" } });
    expect(generalRes.statusCode).toBe(201);

    // admin and moderator both receive the restricted (staff) message first.
    const adminEvent = await adminEventP;
    expect(adminEvent.type).toBe("message.created");
    expect(adminEvent.message).toMatchObject({ content: "top secret", channelId: staffId });

    const modEvent = await modEventP;
    expect(modEvent.type).toBe("message.created");
    expect(modEvent.message).toMatchObject({ content: "top secret", channelId: staffId });

    // the member never gets the staff message — their next event is the
    // member-channel message, proving the restricted content never arrived.
    const memberEvent = await memberEventP;
    expect(memberEvent.type).toBe("message.created");
    expect(memberEvent.message).toMatchObject({ content: "public hello", channelId: generalId });

    wsAdmin.close();
    wsMod.close();
    wsMember.close();
    await Promise.all([closed(wsAdmin), closed(wsMod), closed(wsMember)]);
  });

  it("scopes channel.created to the channel's required capability: a non-holder is excluded, a holder is included", async () => {
    const adminCookie = await loginCookie("theo", "correct horse battery");

    const invA = await app.inject({ method: "POST", url: "/api/invites", headers: { cookie: adminCookie } });
    const regA = await app.inject({ method: "POST", url: "/api/auth/register",
      payload: { inviteToken: invA.json().token, username: "alice", password: "alicepass123" } });
    // Use the session cookie register() already sets, rather than a second
    // /api/auth/login call — /api/auth/login is rate-limited and the test
    // suite's total call count is close to that limit.
    const memberCookie = `sid=${regA.cookies.find((c) => c.name === "sid")!.value}`;

    const wsAdmin = openWs(adminCookie);
    await new Promise((r) => wsAdmin.once("open", r));
    await nextMessage(wsAdmin); // presence.sync
    await nextMessage(wsAdmin); // voice.sync

    const wsMember = openWs(memberCookie);
    await new Promise((r) => wsMember.once("open", r));
    await nextMessage(wsAdmin); // presence.online (alice connects)
    await nextMessage(wsMember); // presence.sync
    await nextMessage(wsMember); // voice.sync

    const adminEventP = nextMessage(wsAdmin);
    const memberEventP = nextMessage(wsMember);

    const staffRes = await app.inject({ method: "POST", url: "/api/channels",
      headers: { cookie: adminCookie }, payload: { name: "staff", type: "text", requiredCapability: "moderate" } });
    expect(staffRes.statusCode).toBe(201);

    const generalRes = await app.inject({ method: "POST", url: "/api/channels",
      headers: { cookie: adminCookie }, payload: { name: "général", type: "text" } });
    expect(generalRes.statusCode).toBe(201);

    // admin receives the restricted (staff) channel.created first.
    const adminEvent = await adminEventP;
    expect(adminEvent.type).toBe("channel.created");
    expect(adminEvent.channel).toMatchObject({ name: "staff", requiredCapability: "moderate" });

    // the member never gets the staff channel.created — their next event is
    // the member-visible channel, proving the restricted event never arrived.
    const memberEvent = await memberEventP;
    expect(memberEvent.type).toBe("channel.created");
    expect(memberEvent.channel).toMatchObject({ name: "général", requiredCapability: null });

    wsAdmin.close();
    wsMember.close();
    await Promise.all([closed(wsAdmin), closed(wsMember)]);
  });

  it("broadcasts channel.deleted to a connected client", async () => {
    const cookie = await loginCookie("theo", "correct horse battery");
    const ch = await app.inject({ method: "POST", url: "/api/channels",
      headers: { cookie }, payload: { name: "temporaire", type: "text" } });
    const channelId = ch.json().id;

    const ws = openWs(cookie);
    await new Promise((r) => ws.once("open", r));
    await nextMessage(ws); // presence.sync
    await nextMessage(ws); // voice.sync

    const eventP = nextMessage(ws);
    const res = await app.inject({ method: "DELETE", url: `/api/channels/${channelId}`,
      headers: { cookie } });
    expect(res.statusCode).toBe(204);

    const event = await eventP;
    expect(event).toEqual({ type: "channel.deleted", channelId });

    ws.close();
    await closed(ws);
  });
});
