import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import { WebSocket } from "ws";
import { makeTestDb } from "./helpers/db.js";
import { buildApp } from "../src/app.js";

let pool: pg.Pool;
let app: FastifyInstance;
let baseUrl: string;

async function loginCookie(username: string, password: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/auth/login",
    payload: { username, password } });
  return `sid=${res.cookies.find((c) => c.name === "sid")!.value}`;
}

function openWs(cookie?: string): WebSocket {
  return new WebSocket(`${baseUrl}/ws`, cookie ? { headers: { cookie } } : {});
}

function nextMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString())));
    ws.once("error", reject);
  });
}

function closed(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.once("close", (code) => resolve(code)));
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
});

describe("websocket", () => {
  it("rejects an unauthenticated connection", async () => {
    const ws = openWs();
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
    ws.send(JSON.stringify({ type: "ping" }));
    const pong = await nextMessage(ws);
    expect(pong).toEqual({ type: "pong" });
    ws.close();
    await closed(ws);
  });

  it("ignores non-object JSON payloads instead of crashing", async () => {
    const cookie = await loginCookie("theo", "correct horse battery");
    const ws = openWs(cookie);
    await new Promise((r) => ws.once("open", r));
    const sync = await nextMessage(ws);
    expect(sync.type).toBe("presence.sync");

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

  it("scopes message.created to the channel's min_role: member is excluded, moderator/admin are included", async () => {
    const adminCookie = await loginCookie("theo", "correct horse battery");

    const staff = await app.inject({ method: "POST", url: "/api/channels",
      headers: { cookie: adminCookie }, payload: { name: "staff", type: "text", minRole: "moderator" } });
    const staffId = staff.json().id;
    const general = await app.inject({ method: "POST", url: "/api/channels",
      headers: { cookie: adminCookie }, payload: { name: "général", type: "text" } });
    const generalId = general.json().id;

    // Use the session cookie register() already sets, rather than a second
    // /api/auth/login call — /api/auth/login is rate-limited and the test
    // suite's total call count is close to that limit. Role is looked up
    // live per-request (not cached in the session), so promoting bob after
    // registering still takes effect on his existing cookie.
    const invA = await app.inject({ method: "POST", url: "/api/invites", headers: { cookie: adminCookie } });
    const regA = await app.inject({ method: "POST", url: "/api/auth/register",
      payload: { inviteToken: invA.json().token, username: "alice", password: "alicepass123" } });
    const memberCookie = `sid=${regA.cookies.find((c) => c.name === "sid")!.value}`;

    const invB = await app.inject({ method: "POST", url: "/api/invites", headers: { cookie: adminCookie } });
    const regB = await app.inject({ method: "POST", url: "/api/auth/register",
      payload: { inviteToken: invB.json().token, username: "bob", password: "bobpass1234" } });
    await pool.query("UPDATE users SET role = 'moderator' WHERE username = $1", ["bob"]);
    const modCookie = `sid=${regB.cookies.find((c) => c.name === "sid")!.value}`;

    // Connect and drain presence.sync one socket at a time so any
    // presence.online noise from a later connect has no listener to land on.
    const wsAdmin = openWs(adminCookie);
    await new Promise((r) => wsAdmin.once("open", r));
    await nextMessage(wsAdmin); // presence.sync

    const wsMod = openWs(modCookie);
    await new Promise((r) => wsMod.once("open", r));
    await nextMessage(wsMod); // presence.sync

    const wsMember = openWs(memberCookie);
    await new Promise((r) => wsMember.once("open", r));
    await nextMessage(wsMember); // presence.sync

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

  it("scopes channel.created to the channel's min_role: member is excluded, admin is included", async () => {
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

    const wsMember = openWs(memberCookie);
    await new Promise((r) => wsMember.once("open", r));
    await nextMessage(wsMember); // presence.sync

    const adminEventP = nextMessage(wsAdmin);
    const memberEventP = nextMessage(wsMember);

    const staffRes = await app.inject({ method: "POST", url: "/api/channels",
      headers: { cookie: adminCookie }, payload: { name: "staff", type: "text", minRole: "moderator" } });
    expect(staffRes.statusCode).toBe(201);

    const generalRes = await app.inject({ method: "POST", url: "/api/channels",
      headers: { cookie: adminCookie }, payload: { name: "général", type: "text" } });
    expect(generalRes.statusCode).toBe(201);

    // admin receives the restricted (staff) channel.created first.
    const adminEvent = await adminEventP;
    expect(adminEvent.type).toBe("channel.created");
    expect(adminEvent.channel).toMatchObject({ name: "staff", minRole: "moderator" });

    // the member never gets the staff channel.created — their next event is
    // the member-visible channel, proving the restricted event never arrived.
    const memberEvent = await memberEventP;
    expect(memberEvent.type).toBe("channel.created");
    expect(memberEvent.channel).toMatchObject({ name: "général", minRole: "member" });

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
