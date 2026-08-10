import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import { makeTestDb } from "./helpers/db.js";
import { buildApp } from "../src/app.js";
import { hashToken } from "../src/auth/sessions.js";
import { CAPABILITIES } from "../src/capabilities.js";

let pool: pg.Pool;
let app: FastifyInstance;

beforeAll(async () => {
  pool = await makeTestDb();
  ({ app } = await buildApp({ pool }));
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
    expect(me.json().username).toBe("theo");
    expect(me.json().capabilities.sort()).toEqual([...CAPABILITIES].sort());
  });

  it("refuses setup when a user already exists", async () => {
    await app.inject({ method: "POST", url: "/api/setup",
      payload: { username: "theo", password: "correct horse battery" } });
    const res = await app.inject({ method: "POST", url: "/api/setup",
      payload: { username: "evil", password: "correct horse battery" } });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /api/setup", () => {
  it("reports done:false before any user exists", async () => {
    const res = await app.inject({ method: "GET", url: "/api/setup" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ done: false });
  });

  it("reports done:true after the first user is created", async () => {
    await app.inject({ method: "POST", url: "/api/setup",
      payload: { username: "theo", password: "correct horse battery" } });
    const res = await app.inject({ method: "GET", url: "/api/setup" });
    expect(res.json()).toEqual({ done: true });
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

  it("rejects an unknown username with the same body as a wrong password", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/login",
      payload: { username: "ghost", password: "whatever1" } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "invalid credentials" });
  });
});

describe("profile", () => {
  it("updates the authenticated user's public profile", async () => {
    const setup = await app.inject({ method: "POST", url: "/api/setup",
      payload: { username: "theo", password: "correct horse battery" } });
    const cookie = sidCookie(setup);
    const avatarUrl = `data:image/png;base64,${Buffer.from("avatar").toString("base64")}`;

    const update = await app.inject({
      method: "PATCH", url: "/api/me", headers: { cookie },
      payload: { username: "theophile", email: "theo@example.com", description: "Building Vocal", avatarUrl },
    });

    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({ username: "theophile", email: "theo@example.com", description: "Building Vocal", avatarUrl });
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    expect(me.json()).toMatchObject({ username: "theophile", email: "theo@example.com", description: "Building Vocal", avatarUrl });
  });

  it("allows a profile without an email address", async () => {
    const setup = await app.inject({ method: "POST", url: "/api/setup",
      payload: { username: "theo", password: "correct horse battery" } });
    const update = await app.inject({
      method: "PATCH", url: "/api/me", headers: { cookie: sidCookie(setup) },
      payload: { username: "theo", email: null, description: "No public email", avatarUrl: null },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({ email: null, description: "No public email" });
  });

  it("rejects duplicate usernames and invalid profile images", async () => {
    const setup = await app.inject({ method: "POST", url: "/api/setup",
      payload: { username: "theo", password: "correct horse battery" } });
    await app.inject({ method: "POST", url: "/api/auth/register",
      payload: { username: "alice", password: "alicepass123" } });
    const cookie = sidCookie(setup);
    const duplicate = await app.inject({ method: "PATCH", url: "/api/me", headers: { cookie },
      payload: { username: "alice", email: "", description: "", avatarUrl: null } });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toEqual({ error: "username taken" });

    const invalidImage = await app.inject({ method: "PATCH", url: "/api/me", headers: { cookie },
      payload: { username: "theo", email: "", description: "", avatarUrl: "https://example.com/avatar.png" } });
    expect(invalidImage.statusCode).toBe(400);
    expect(invalidImage.json()).toEqual({ error: "invalid profile picture" });
  });
});

describe("register", () => {
  it("allows public registration without an invite and logs the member in", async () => {
    await app.inject({ method: "POST", url: "/api/setup",
      payload: { username: "theo", password: "correct horse battery" } });

    const res = await app.inject({ method: "POST", url: "/api/auth/register",
      payload: { username: "alice", password: "alicepass123" } });

    expect(res.statusCode).toBe(201);
    const me = await app.inject({ method: "GET", url: "/api/me",
      headers: { cookie: sidCookie(res) } });
    expect(me.json()).toMatchObject({ username: "alice", capabilities: ["publish_voice"] });
  });

  it("returns 409 with 'username taken' when the username already exists", async () => {
    const setup = await app.inject({ method: "POST", url: "/api/setup",
      payload: { username: "theo", password: "correct horse battery" } });
    const adminId = (await app.inject({
      method: "GET", url: "/api/me", headers: { cookie: sidCookie(setup) },
    })).json().id;

    const token = "a-known-invite-token";
    await pool.query(
      `INSERT INTO invites (token_hash, created_by, expires_at)
       VALUES ($1, $2, now() + interval '1 day')`,
      [hashToken(token), adminId],
    );

    const res = await app.inject({
      method: "POST", url: "/api/auth/register",
      payload: {
        username: "theo",
        password: "another password",
        inviteToken: token,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "username taken" });
  });
});
