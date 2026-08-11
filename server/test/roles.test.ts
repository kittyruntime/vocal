import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { buildApp } from "../src/app.js";
import { makeTestDb } from "./helpers/db.js";

let app: FastifyInstance; let pool: pg.Pool; let adminCookie: string;

beforeAll(async () => { process.env.MESSAGE_MASTER_KEY ??= Buffer.alloc(32, 7).toString("base64"); pool = await makeTestDb(); ({ app } = await buildApp({ pool })); });
afterAll(async () => { await app.close(); await pool.end(); });
beforeEach(async () => {
  await pool.query("TRUNCATE users, sessions, invites, channels CASCADE");
  const setup = await app.inject({ method: "POST", url: "/api/setup", payload: { username: "theo", password: "correct horse battery" } });
  adminCookie = `sid=${setup.cookies.find((cookie) => cookie.name === "sid")!.value}`;
});

describe("roles", () => {
  it("creates a reusable role and grants its effective capabilities", async () => {
    const created = await app.inject({ method: "POST", url: "/api/admin/roles", headers: { cookie: adminCookie }, payload: { name: "Helpers", color: "#57f287", capabilities: ["moderate"] } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: "Helpers", color: "#57f287", capabilities: ["moderate"], memberCount: 0 });
    const invite = await app.inject({ method: "POST", url: "/api/invites", headers: { cookie: adminCookie } });
    const registered = await app.inject({ method: "POST", url: "/api/auth/register", payload: { inviteToken: invite.json().token, username: "alice", password: "alicepass123" } });
    const aliceCookie = `sid=${registered.cookies.find((cookie) => cookie.name === "sid")!.value}`;
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: aliceCookie } });
    const assigned = await app.inject({ method: "PUT", url: `/api/admin/users/${me.json().id}/roles`, headers: { cookie: adminCookie }, payload: { roleIds: [created.json().id] } });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().capabilities).toEqual(expect.arrayContaining(["publish_voice", "moderate"]));
    const refreshed = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: aliceCookie } });
    expect(refreshed.json().capabilities).toEqual(expect.arrayContaining(["publish_voice", "moderate"]));
  });
});
