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
});
