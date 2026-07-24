import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import { makeTestDb } from "./helpers/db.js";
import { buildApp } from "../src/app.js";

let pool: pg.Pool;
let app: FastifyInstance;

beforeAll(async () => {
  pool = await makeTestDb();
  app = await buildApp({ pool });
});
afterAll(async () => { await app.close(); await pool.end(); });
beforeEach(async () => {
  await pool.query("TRUNCATE users, sessions, invites CASCADE");
});

function sidCookie(res: { cookies: { name: string; value: string }[] }): string {
  const c = res.cookies.find((c) => c.name === "sid");
  if (!c) throw new Error("no sid cookie");
  return `sid=${c.value}`;
}

describe("setup", () => {
  it("creates the first user as admin and logs in", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/setup",
      payload: { username: "theo", password: "correct horse battery" },
    });
    expect(res.statusCode).toBe(201);
    const me = await app.inject({
      method: "GET", url: "/api/me", headers: { cookie: sidCookie(res) },
    });
    expect(me.json()).toMatchObject({ username: "theo", role: "admin" });
  });

  it("refuses setup when a user already exists", async () => {
    await app.inject({ method: "POST", url: "/api/setup",
      payload: { username: "theo", password: "correct horse battery" } });
    const res = await app.inject({ method: "POST", url: "/api/setup",
      payload: { username: "evil", password: "correct horse battery" } });
    expect(res.statusCode).toBe(403);
  });
});

describe("login / logout", () => {
  beforeEach(async () => {
    await app.inject({ method: "POST", url: "/api/setup",
      payload: { username: "theo", password: "correct horse battery" } });
  });

  it("logs in with valid credentials", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/login",
      payload: { username: "theo", password: "correct horse battery" } });
    expect(res.statusCode).toBe(200);
    const me = await app.inject({ method: "GET", url: "/api/me",
      headers: { cookie: sidCookie(res) } });
    expect(me.statusCode).toBe(200);
  });

  it("rejects a wrong password", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/login",
      payload: { username: "theo", password: "wrong" } });
    expect(res.statusCode).toBe(401);
  });

  it("logout revokes the session", async () => {
    const login = await app.inject({ method: "POST", url: "/api/auth/login",
      payload: { username: "theo", password: "correct horse battery" } });
    const cookie = sidCookie(login);
    await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it("GET /api/me without cookie is 401", async () => {
    const me = await app.inject({ method: "GET", url: "/api/me" });
    expect(me.statusCode).toBe(401);
  });
});
