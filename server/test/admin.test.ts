import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import { makeTestDb } from "./helpers/db.js";
import { buildApp } from "../src/app.js";

let pool: pg.Pool; let app: FastifyInstance; let adminCookie: string;
beforeAll(async () => { pool = await makeTestDb(); ({ app } = await buildApp({ pool })); });
afterAll(async () => { await app.close(); await pool.end(); });
beforeEach(async () => {
  await pool.query("TRUNCATE users, sessions, invites, channels CASCADE");
  await pool.query("UPDATE server_settings SET registration_open = true");
  const setup = await app.inject({ method: "POST", url: "/api/setup", payload: { username: "theo", password: "correct horse battery" } });
  adminCookie = `sid=${setup.cookies.find((cookie) => cookie.name === "sid")!.value}`;
});

describe("server administration", () => {
  it("closes public registration while preserving invited registration", async () => {
    await app.inject({ method: "PATCH", url: "/api/admin/settings", headers: { cookie: adminCookie }, payload: { registrationOpen: false } });
    const publicRegistration = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "alice", password: "password123" } });
    expect(publicRegistration.statusCode).toBe(403);
    expect(publicRegistration.json()).toEqual({ error: "registration closed" });
    const invite = await app.inject({ method: "POST", url: "/api/invites", headers: { cookie: adminCookie } });
    const invited = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "alice", password: "password123", inviteToken: invite.json().token } });
    expect(invited.statusCode).toBe(201);
  });

  it("lists users and changes their role", async () => {
    await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "alice", password: "password123" } });
    const list = await app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: adminCookie } });
    const alice = list.json().find((user: { username: string }) => user.username === "alice");
    const update = await app.inject({ method: "PATCH", url: `/api/admin/users/${alice.id}`, headers: { cookie: adminCookie }, payload: { role: "moderator" } });
    expect(update.json()).toMatchObject({ username: "alice", role: "moderator" });
  });
});
