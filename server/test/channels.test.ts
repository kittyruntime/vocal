import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type pg from "pg";
import type { FastifyInstance } from "fastify";
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

async function makeMember(username: string): Promise<string> {
  const inv = await app.inject({ method: "POST", url: "/api/invites",
    headers: { cookie: adminCookie } });
  const { token } = inv.json();
  const reg = await app.inject({ method: "POST", url: "/api/auth/register",
    payload: { inviteToken: token, username, password: "memberpass123" } });
  return `sid=${reg.cookies.find((c) => c.name === "sid")!.value}`;
}

beforeAll(async () => { pool = await makeTestDb(); app = await buildApp({ pool }); });
afterAll(async () => { await app.close(); await pool.end(); });

beforeEach(async () => {
  await pool.query("TRUNCATE users, sessions, invites, channels CASCADE");
  await app.inject({ method: "POST", url: "/api/setup",
    payload: { username: "theo", password: "correct horse battery" } });
  adminCookie = await login("theo", "correct horse battery");
});

describe("channels", () => {
  it("admin creates text and voice channels", async () => {
    const text = await app.inject({ method: "POST", url: "/api/channels",
      headers: { cookie: adminCookie }, payload: { name: "général", type: "text" } });
    expect(text.statusCode).toBe(201);
    expect(text.json()).toMatchObject({ name: "général", type: "text", minRole: "member" });

    const voice = await app.inject({ method: "POST", url: "/api/channels",
      headers: { cookie: adminCookie }, payload: { name: "vocal", type: "voice" } });
    expect(voice.statusCode).toBe(201);
    expect(voice.json().type).toBe("voice");
  });

  it("rejects invalid channel type", async () => {
    const res = await app.inject({ method: "POST", url: "/api/channels",
      headers: { cookie: adminCookie }, payload: { name: "x", type: "video" } });
    expect(res.statusCode).toBe(400);
  });

  it("non-admin cannot create a channel", async () => {
    const memberCookie = await makeMember("alice");
    const res = await app.inject({ method: "POST", url: "/api/channels",
      headers: { cookie: memberCookie }, payload: { name: "x", type: "text" } });
    expect(res.statusCode).toBe(403);
  });

  it("GET /api/channels hides channels above the user's role", async () => {
    await app.inject({ method: "POST", url: "/api/channels", headers: { cookie: adminCookie },
      payload: { name: "public", type: "text", minRole: "member" } });
    await app.inject({ method: "POST", url: "/api/channels", headers: { cookie: adminCookie },
      payload: { name: "staff", type: "text", minRole: "moderator" } });
    const memberCookie = await makeMember("alice");
    const list = await app.inject({ method: "GET", url: "/api/channels",
      headers: { cookie: memberCookie } });
    const names = list.json().map((c: { name: string }) => c.name);
    expect(names).toContain("public");
    expect(names).not.toContain("staff");
  });

  it("admin sees all channels", async () => {
    await app.inject({ method: "POST", url: "/api/channels", headers: { cookie: adminCookie },
      payload: { name: "staff", type: "text", minRole: "moderator" } });
    const list = await app.inject({ method: "GET", url: "/api/channels",
      headers: { cookie: adminCookie } });
    expect(list.json().map((c: { name: string }) => c.name)).toContain("staff");
  });

  it("deletes a channel", async () => {
    const created = await app.inject({ method: "POST", url: "/api/channels",
      headers: { cookie: adminCookie }, payload: { name: "temp", type: "text" } });
    const { id } = created.json();
    const del = await app.inject({ method: "DELETE", url: `/api/channels/${id}`,
      headers: { cookie: adminCookie } });
    expect(del.statusCode).toBe(204);
    const list = await app.inject({ method: "GET", url: "/api/channels",
      headers: { cookie: adminCookie } });
    expect(list.json()).toHaveLength(0);
  });

  it("rejects a malformed channel id on delete", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/channels/not-a-uuid",
      headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(400);
  });
});
