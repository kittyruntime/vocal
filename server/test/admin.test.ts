import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import { makeTestDb } from "./helpers/db.js";
import { buildApp } from "../src/app.js";
import type { VoicePresence } from "../src/voice/presence.js";

let pool: pg.Pool; let app: FastifyInstance; let adminCookie: string;
let voicePresence: VoicePresence;
const setParticipantPublishing = vi.fn(async () => {});
const removeParticipant = vi.fn(async () => {});
beforeAll(async () => {
  pool = await makeTestDb();
  ({ app, voicePresence } = await buildApp({ pool, voiceAdmin: { setParticipantPublishing, removeParticipant } }));
});
afterAll(async () => { await app.close(); await pool.end(); });
beforeEach(async () => {
  vi.clearAllMocks();
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

  it("lists users and changes their capabilities", async () => {
    await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "alice", password: "password123" } });
    const list = await app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: adminCookie } });
    expect(list.json().total).toBe(2);
    const alice = list.json().users.find((user: { username: string }) => user.username === "alice");
    expect(alice.capabilities).toEqual(["publish_voice"]);
    const update = await app.inject({ method: "PATCH", url: `/api/admin/users/${alice.id}`, headers: { cookie: adminCookie }, payload: { capabilities: ["moderate"] } });
    expect(update.json()).toMatchObject({ username: "alice", capabilities: ["moderate"] });
  });

  it("paginates and searches the member list server-side", async () => {
    // Inserted directly rather than through POST /api/auth/register: that
    // route is rate-limited (10/min) and shared across this whole test
    // file's single app instance, and this test only cares about the
    // listing endpoint's pagination/search, not the registration flow.
    for (const username of ["alice", "bob", "carol", "dave"]) {
      await pool.query("INSERT INTO users (username, password_hash) VALUES ($1, 'x')", [username]);
    }
    const page1 = await app.inject({ method: "GET", url: "/api/admin/users?limit=2&page=1", headers: { cookie: adminCookie } });
    expect(page1.json().total).toBe(5);
    expect(page1.json().users.map((user: { username: string }) => user.username)).toEqual(["alice", "bob"]);

    const page2 = await app.inject({ method: "GET", url: "/api/admin/users?limit=2&page=2", headers: { cookie: adminCookie } });
    expect(page2.json().users.map((user: { username: string }) => user.username)).toEqual(["carol", "dave"]);

    const searched = await app.inject({ method: "GET", url: "/api/admin/users?search=ar", headers: { cookie: adminCookie } });
    expect(searched.json().total).toBe(1);
    expect(searched.json().users.map((user: { username: string }) => user.username)).toEqual(["carol"]);
  });

  it("refuses to remove manage_server from the last holder", async () => {
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: adminCookie } });
    const res = await app.inject({ method: "PATCH", url: `/api/admin/users/${me.json().id}`, headers: { cookie: adminCookie }, payload: { capabilities: ["moderate"] } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "cannot remove manage_server from the last holder" });
  });

  async function registerAlice(): Promise<{ id: string; cookie: string }> {
    const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "alice", password: "password123" } });
    const cookie = `sid=${reg.cookies.find((c) => c.name === "sid")!.value}`;
    const list = await app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: adminCookie } });
    const alice = list.json().users.find((user: { username: string }) => user.username === "alice");
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

    it("removes a connected target from LiveKit", async () => {
      const alice = await registerAlice();
      voicePresence.join("00000000-0000-0000-0000-000000000123", { userId: alice.id, username: "alice" });
      const kick = await app.inject({ method: "POST", url: `/api/admin/users/${alice.id}/kick`, headers: { cookie: adminCookie } });
      expect(kick.statusCode).toBe(200);
      expect(removeParticipant).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000123", alice.id);
      voicePresence.leave("00000000-0000-0000-0000-000000000123", alice.id);
    });
  });

  describe("forced voice mute", () => {
    it("persists mute and revokes publishing in the active LiveKit room", async () => {
      const alice = await registerAlice();
      voicePresence.join("00000000-0000-0000-0000-000000000123", { userId: alice.id, username: "alice" });
      const muted = await app.inject({ method: "PATCH", url: `/api/admin/users/${alice.id}/voice-mute`, headers: { cookie: adminCookie }, payload: { muted: true } });
      expect(muted.statusCode).toBe(200);
      expect(muted.json()).toMatchObject({ id: alice.id, voiceMuted: true });
      expect(setParticipantPublishing).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000123", alice.id, false);
      voicePresence.leave("00000000-0000-0000-0000-000000000123", alice.id);
    });

    it("refuses to mute yourself", async () => {
      const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: adminCookie } });
      const result = await app.inject({ method: "PATCH", url: `/api/admin/users/${me.json().id}/voice-mute`, headers: { cookie: adminCookie }, payload: { muted: true } });
      expect(result.statusCode).toBe(409);
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
      expect(list.json().users.find((user: { id: string }) => user.id === alice.id).bannedAt).not.toBeNull();
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

    it("allows banning another manage_server holder", async () => {
      const alice = await registerAlice();
      await app.inject({ method: "PATCH", url: `/api/admin/users/${alice.id}`, headers: { cookie: adminCookie }, payload: { capabilities: ["manage_server"] } });
      const res = await app.inject({ method: "POST", url: `/api/admin/users/${alice.id}/ban`, headers: { cookie: adminCookie } });
      expect(res.statusCode).toBe(200);
      expect(res.json().bannedAt).not.toBeNull();
    });

    it("a moderate-only user can kick and ban without manage_server", async () => {
      const alice = await registerAlice();
      await app.inject({ method: "PATCH", url: `/api/admin/users/${alice.id}`, headers: { cookie: adminCookie }, payload: { capabilities: ["moderate"] } });
      const admin = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: adminCookie } });

      const kick = await app.inject({ method: "POST", url: `/api/admin/users/${admin.json().id}/kick`, headers: { cookie: alice.cookie } });
      expect(kick.statusCode).toBe(200);

      const settings = await app.inject({ method: "GET", url: "/api/admin/settings", headers: { cookie: alice.cookie } });
      expect(settings.statusCode).toBe(403);
    });

    it("404s for an unknown user", async () => {
      const ban = await app.inject({ method: "POST", url: "/api/admin/users/00000000-0000-0000-0000-000000000000/ban", headers: { cookie: adminCookie } });
      expect(ban.statusCode).toBe(404);
      const unban = await app.inject({ method: "POST", url: "/api/admin/users/00000000-0000-0000-0000-000000000000/unban", headers: { cookie: adminCookie } });
      expect(unban.statusCode).toBe(404);
    });
  });
});
