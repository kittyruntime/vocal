import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import { makeTestDb } from "./helpers/db.js";
import { buildApp } from "../src/app.js";

let pool: pg.Pool;
let app: FastifyInstance;
let adminCookie: string;

beforeAll(async () => {
  pool = await makeTestDb();
  app = await buildApp({ pool });
});
afterAll(async () => { await app.close(); await pool.end(); });

beforeEach(async () => {
  await pool.query("TRUNCATE users, sessions, invites CASCADE");
  const res = await app.inject({ method: "POST", url: "/api/setup",
    payload: { username: "theo", password: "correct horse battery" } });
  adminCookie = `sid=${res.cookies.find((c) => c.name === "sid")!.value}`;
});

describe("invites", () => {
  it("admin creates an invite and a friend registers with it", async () => {
    const created = await app.inject({ method: "POST", url: "/api/invites",
      headers: { cookie: adminCookie } });
    expect(created.statusCode).toBe(201);
    const { token } = created.json();
    expect(token).toBeTruthy();

    const reg = await app.inject({ method: "POST", url: "/api/auth/register",
      payload: { inviteToken: token, username: "alice", password: "hunter2hunter2" } });
    expect(reg.statusCode).toBe(201);

    const again = await app.inject({ method: "POST", url: "/api/auth/register",
      payload: { inviteToken: token, username: "bob", password: "hunter2hunter2" } });
    expect(again.statusCode).toBe(403); // usage unique
  });

  it("non-admin cannot create invites", async () => {
    const created = await app.inject({ method: "POST", url: "/api/invites",
      headers: { cookie: adminCookie } });
    const { token } = created.json();
    const reg = await app.inject({ method: "POST", url: "/api/auth/register",
      payload: { inviteToken: token, username: "alice", password: "hunter2hunter2" } });
    const aliceCookie = `sid=${reg.cookies.find((c) => c.name === "sid")!.value}`;
    const res = await app.inject({ method: "POST", url: "/api/invites",
      headers: { cookie: aliceCookie } });
    expect(res.statusCode).toBe(403);
  });

  it("expired invites are rejected", async () => {
    const created = await app.inject({ method: "POST", url: "/api/invites",
      headers: { cookie: adminCookie } });
    const { id, token } = created.json();
    await pool.query("UPDATE invites SET expires_at = now() - interval '1 hour' WHERE id = $1", [id]);
    const reg = await app.inject({ method: "POST", url: "/api/auth/register",
      payload: { inviteToken: token, username: "alice", password: "hunter2hunter2" } });
    expect(reg.statusCode).toBe(403);
  });

  it("lists and deletes invites", async () => {
    const created = await app.inject({ method: "POST", url: "/api/invites",
      headers: { cookie: adminCookie } });
    const { id } = created.json();
    const list = await app.inject({ method: "GET", url: "/api/invites",
      headers: { cookie: adminCookie } });
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0]).not.toHaveProperty("token");
    const del = await app.inject({ method: "DELETE", url: `/api/invites/${id}`,
      headers: { cookie: adminCookie } });
    expect(del.statusCode).toBe(204);
    const list2 = await app.inject({ method: "GET", url: "/api/invites",
      headers: { cookie: adminCookie } });
    expect(list2.json()).toHaveLength(0);
  });
});
