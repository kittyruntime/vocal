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

  async function registerAlice(): Promise<{ id: string; cookie: string }> {
    const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "alice", password: "password123" } });
    const cookie = `sid=${reg.cookies.find((c) => c.name === "sid")!.value}`;
    const list = await app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: adminCookie } });
    const alice = list.json().find((user: { username: string }) => user.username === "alice");
    return { id: alice.id, cookie };
  }

  describe("kick", () => {
    it("revokes the target's sessions without banning them", async () => {
      const alice = await registerAlice();
      const kick = await app.inject({ method: "POST", url: `/api/admin/users/${alice.id}/kick`, headers: { cookie: adminCookie } });
      expect(kick.statusCode).toBe(200);
      const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: alice.cookie } });
      expect(me.statusCode).toBe(401);
      const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "alice", password: "password123" } });
      expect(login.statusCode).toBe(200);
    });

    it("404s for an unknown user", async () => {
      const res = await app.inject({ method: "POST", url: "/api/admin/users/00000000-0000-0000-0000-000000000000/kick", headers: { cookie: adminCookie } });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("ban / unban", () => {
    it("revokes sessions, blocks login, and is reflected in the user list", async () => {
      const alice = await registerAlice();
      const ban = await app.inject({ method: "POST", url: `/api/admin/users/${alice.id}/ban`, headers: { cookie: adminCookie } });
      expect(ban.statusCode).toBe(200);
      expect(ban.json().bannedAt).not.toBeNull();

      const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: alice.cookie } });
      expect(me.statusCode).toBe(401);

      const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "alice", password: "password123" } });
      expect(login.statusCode).toBe(403);
      expect(login.json()).toEqual({ error: "account banned" });

      const list = await app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: adminCookie } });
      expect(list.json().find((user: { id: string }) => user.id === alice.id).bannedAt).not.toBeNull();
    });

    it("restores login after unban", async () => {
      const alice = await registerAlice();
      await app.inject({ method: "POST", url: `/api/admin/users/${alice.id}/ban`, headers: { cookie: adminCookie } });
      const unban = await app.inject({ method: "POST", url: `/api/admin/users/${alice.id}/unban`, headers: { cookie: adminCookie } });
      expect(unban.statusCode).toBe(200);
      expect(unban.json().bannedAt).toBeNull();
      const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "alice", password: "password123" } });
      expect(login.statusCode).toBe(200);
    });

    it("refuses to ban yourself", async () => {
      const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: adminCookie } });
      const res = await app.inject({ method: "POST", url: `/api/admin/users/${me.json().id}/ban`, headers: { cookie: adminCookie } });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: "cannot ban yourself" });
    });

    it("allows banning another admin when at least one admin remains", async () => {
      const alice = await registerAlice();
      await app.inject({ method: "PATCH", url: `/api/admin/users/${alice.id}`, headers: { cookie: adminCookie }, payload: { role: "admin" } });
      const res = await app.inject({ method: "POST", url: `/api/admin/users/${alice.id}/ban`, headers: { cookie: adminCookie } });
      expect(res.statusCode).toBe(200);
      expect(res.json().bannedAt).not.toBeNull();
    });

    it("404s for an unknown user", async () => {
      const ban = await app.inject({ method: "POST", url: "/api/admin/users/00000000-0000-0000-0000-000000000000/ban", headers: { cookie: adminCookie } });
      expect(ban.statusCode).toBe(404);
      const unban = await app.inject({ method: "POST", url: "/api/admin/users/00000000-0000-0000-0000-000000000000/unban", headers: { cookie: adminCookie } });
      expect(unban.statusCode).toBe(404);
    });
  });
});
