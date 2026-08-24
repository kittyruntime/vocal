import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import { makeTestDb } from "./helpers/db.js";
import { buildApp } from "../src/app.js";
import { createSession } from "../src/auth/sessions.js";

let pool: pg.Pool;
let app: FastifyInstance;
let adminCookie: string;
let adminId: string;

beforeAll(async () => {
  process.env.MESSAGE_MASTER_KEY ??= Buffer.alloc(32, 7).toString("base64");
  pool = await makeTestDb();
  ({ app } = await buildApp({ pool }));
});
afterAll(async () => { await app.close(); await pool.end(); });

beforeEach(async () => {
  await pool.query("TRUNCATE users, sessions, invites, channels, messages, conversations CASCADE");
  const setup = await app.inject({ method: "POST", url: "/api/setup",
    payload: { username: "theo", password: "correct horse battery" } });
  adminCookie = `sid=${setup.cookies.find((cookie) => cookie.name === "sid")!.value}`;
  const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: adminCookie } });
  adminId = me.json().id;
});

// Creates a user and session directly (bypassing the rate-limited
// /api/auth/register HTTP flow, which this file's many small tests would
// otherwise exhaust) since these tests only need a logged-in second/third
// user, not the registration flow itself.
async function registerUser(username: string): Promise<{ cookie: string; id: string }> {
  const inserted = await pool.query<{ id: string }>("INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id", [username]);
  const id = inserted.rows[0].id;
  await pool.query("INSERT INTO user_capabilities (user_id, capability) VALUES ($1, 'publish_voice')", [id]);
  const { token } = await createSession(pool, id);
  return { cookie: `sid=${token}`, id };
}

describe("direct messages", () => {
  it("creates a 1:1 conversation and reuses it on a second request", async () => {
    const alice = await registerUser("alice");
    const first = await app.inject({ method: "POST", url: "/api/conversations",
      headers: { cookie: adminCookie }, payload: { type: "dm", userId: alice.id } });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ type: "dm", name: null });
    expect(first.json().participants.map((p: { userId: string }) => p.userId).sort()).toEqual([adminId, alice.id].sort());

    const second = await app.inject({ method: "POST", url: "/api/conversations",
      headers: { cookie: alice.cookie }, payload: { type: "dm", userId: adminId } });
    expect(second.json().id).toBe(first.json().id);
  });

  it("rejects starting a dm with yourself", async () => {
    const res = await app.inject({ method: "POST", url: "/api/conversations",
      headers: { cookie: adminCookie }, payload: { type: "dm", userId: adminId } });
    expect(res.statusCode).toBe(400);
  });

  it("lists only the current user's conversations", async () => {
    const alice = await registerUser("alice");
    const bob = await registerUser("bob");
    await app.inject({ method: "POST", url: "/api/conversations", headers: { cookie: adminCookie }, payload: { type: "dm", userId: alice.id } });
    await app.inject({ method: "POST", url: "/api/conversations", headers: { cookie: alice.cookie }, payload: { type: "dm", userId: bob.id } });

    const adminList = await app.inject({ method: "GET", url: "/api/conversations", headers: { cookie: adminCookie } });
    expect(adminList.json()).toHaveLength(1);
    const bobList = await app.inject({ method: "GET", url: "/api/conversations", headers: { cookie: bob.cookie } });
    expect(bobList.json()).toHaveLength(1);
  });

  it("sends, lists and paginates messages in a conversation", async () => {
    const alice = await registerUser("alice");
    const conv = await app.inject({ method: "POST", url: "/api/conversations", headers: { cookie: adminCookie }, payload: { type: "dm", userId: alice.id } });
    const conversationId = conv.json().id;
    for (const n of ["m1", "m2", "m3"]) {
      await app.inject({ method: "POST", url: `/api/conversations/${conversationId}/messages`, headers: { cookie: adminCookie }, payload: { content: n } });
    }
    const page1 = await app.inject({ method: "GET", url: `/api/conversations/${conversationId}/messages?limit=2`, headers: { cookie: alice.cookie } });
    expect(page1.json().map((m: { content: string }) => m.content)).toEqual(["m3", "m2"]);
    expect(page1.json()[0]).toMatchObject({ conversationId });
    expect(page1.json()[0].channelId).toBeUndefined();
  });

  it("stores conversation message content encrypted at rest", async () => {
    const alice = await registerUser("alice");
    const conv = await app.inject({ method: "POST", url: "/api/conversations", headers: { cookie: adminCookie }, payload: { type: "dm", userId: alice.id } });
    await app.inject({ method: "POST", url: `/api/conversations/${conv.json().id}/messages`, headers: { cookie: adminCookie }, payload: { content: "secret dm" } });
    const raw = await pool.query("SELECT content_encrypted FROM messages WHERE conversation_id = $1", [conv.json().id]);
    expect(raw.rows[0].content_encrypted).not.toContain("secret dm");
  });

  it("404s a non-participant reading or posting to a conversation", async () => {
    const alice = await registerUser("alice");
    const bob = await registerUser("bob");
    const conv = await app.inject({ method: "POST", url: "/api/conversations", headers: { cookie: adminCookie }, payload: { type: "dm", userId: alice.id } });
    const conversationId = conv.json().id;
    const read = await app.inject({ method: "GET", url: `/api/conversations/${conversationId}/messages`, headers: { cookie: bob.cookie } });
    expect(read.statusCode).toBe(404);
    const write = await app.inject({ method: "POST", url: `/api/conversations/${conversationId}/messages`, headers: { cookie: bob.cookie }, payload: { content: "hi" } });
    expect(write.statusCode).toBe(404);
  });

  it("edits and deletes an owned conversation message, and forbids editing another's", async () => {
    const alice = await registerUser("alice");
    const conv = await app.inject({ method: "POST", url: "/api/conversations", headers: { cookie: adminCookie }, payload: { type: "dm", userId: alice.id } });
    const conversationId = conv.json().id;
    const created = await app.inject({ method: "POST", url: `/api/conversations/${conversationId}/messages`, headers: { cookie: adminCookie }, payload: { content: "before" } });
    const messageId = created.json().id;

    const stolen = await app.inject({ method: "PATCH", url: `/api/conversations/${conversationId}/messages/${messageId}`, headers: { cookie: alice.cookie }, payload: { content: "stolen" } });
    expect(stolen.statusCode).toBe(403);

    const edited = await app.inject({ method: "PATCH", url: `/api/conversations/${conversationId}/messages/${messageId}`, headers: { cookie: adminCookie }, payload: { content: "after" } });
    expect(edited.json()).toMatchObject({ content: "after" });

    const deleted = await app.inject({ method: "DELETE", url: `/api/conversations/${conversationId}/messages/${messageId}`, headers: { cookie: adminCookie } });
    expect(deleted.statusCode).toBe(204);
  });

  it("adds and removes a reaction on a conversation message", async () => {
    const alice = await registerUser("alice");
    const conv = await app.inject({ method: "POST", url: "/api/conversations", headers: { cookie: adminCookie }, payload: { type: "dm", userId: alice.id } });
    const conversationId = conv.json().id;
    const created = await app.inject({ method: "POST", url: `/api/conversations/${conversationId}/messages`, headers: { cookie: adminCookie }, payload: { content: "react" } });
    const url = `/api/conversations/${conversationId}/messages/${created.json().id}/reactions`;
    const added = await app.inject({ method: "PUT", url, headers: { cookie: alice.cookie }, payload: { emoji: "👍" } });
    expect(added.json().reactions).toMatchObject([{ emoji: "👍", count: 1 }]);
    const removed = await app.inject({ method: "DELETE", url, headers: { cookie: alice.cookie }, payload: { emoji: "👍" } });
    expect(removed.json().reactions).toEqual([]);
  });

  it("uploads and serves an attachment scoped to conversation participants", async () => {
    const alice = await registerUser("alice");
    const bob = await registerUser("bob");
    const conv = await app.inject({ method: "POST", url: "/api/conversations", headers: { cookie: adminCookie }, payload: { type: "dm", userId: alice.id } });
    const conversationId = conv.json().id;
    const boundary = "----vocal-test-boundary";
    const chunks = [
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="content"\r\n\r\na picture\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="hello.png"\r\nContent-Type: image/png\r\n\r\n`),
      Buffer.from("fake-png"), Buffer.from(`\r\n--${boundary}--\r\n`),
    ];
    const posted = await app.inject({
      method: "POST", url: `/api/conversations/${conversationId}/messages`,
      headers: { cookie: adminCookie, "content-type": `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat(chunks),
    });
    const attachmentUrl = posted.json().attachments[0].url;

    const allowed = await app.inject({ method: "GET", url: attachmentUrl, headers: { cookie: alice.cookie } });
    expect(allowed.statusCode).toBe(200);
    const forbidden = await app.inject({ method: "GET", url: attachmentUrl, headers: { cookie: bob.cookie } });
    expect(forbidden.statusCode).toBe(403);
  });
});

describe("group conversations", () => {
  it("creates a group with a name and multiple participants", async () => {
    const alice = await registerUser("alice");
    const bob = await registerUser("bob");
    const res = await app.inject({ method: "POST", url: "/api/conversations",
      headers: { cookie: adminCookie }, payload: { type: "group", name: "trio", participantIds: [alice.id, bob.id] } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ type: "group", name: "trio" });
    expect(res.json().participants).toHaveLength(3);
  });

  it("renames a group, forbids renaming a dm", async () => {
    const alice = await registerUser("alice");
    const bob = await registerUser("bob");
    const group = await app.inject({ method: "POST", url: "/api/conversations",
      headers: { cookie: adminCookie }, payload: { type: "group", participantIds: [alice.id, bob.id] } });
    const renamed = await app.inject({ method: "PATCH", url: `/api/conversations/${group.json().id}`,
      headers: { cookie: alice.cookie }, payload: { name: "renamed" } });
    expect(renamed.json()).toMatchObject({ name: "renamed" });

    const dm = await app.inject({ method: "POST", url: "/api/conversations", headers: { cookie: adminCookie }, payload: { type: "dm", userId: alice.id } });
    const failedRename = await app.inject({ method: "PATCH", url: `/api/conversations/${dm.json().id}`, headers: { cookie: adminCookie }, payload: { name: "nope" } });
    expect(failedRename.statusCode).toBe(400);
  });

  it("adds and removes a participant, deletes the conversation when it empties out", async () => {
    const alice = await registerUser("alice");
    const bob = await registerUser("bob");
    const group = await app.inject({ method: "POST", url: "/api/conversations",
      headers: { cookie: adminCookie }, payload: { type: "group", participantIds: [alice.id] } });
    const conversationId = group.json().id;

    const added = await app.inject({ method: "POST", url: `/api/conversations/${conversationId}/participants`, headers: { cookie: adminCookie }, payload: { userId: bob.id } });
    expect(added.json().participants).toHaveLength(3);

    const dmConv = await app.inject({ method: "POST", url: "/api/conversations", headers: { cookie: adminCookie }, payload: { type: "dm", userId: bob.id } });
    const dmAddAttempt = await app.inject({ method: "POST", url: `/api/conversations/${dmConv.json().id}/participants`, headers: { cookie: adminCookie }, payload: { userId: alice.id } });
    expect(dmAddAttempt.statusCode).toBe(400);

    await app.inject({ method: "DELETE", url: `/api/conversations/${conversationId}/participants/${bob.id}`, headers: { cookie: alice.cookie } });
    await app.inject({ method: "DELETE", url: `/api/conversations/${conversationId}/participants/${alice.id}`, headers: { cookie: adminCookie } });
    await app.inject({ method: "DELETE", url: `/api/conversations/${conversationId}/participants/${adminId}`, headers: { cookie: adminCookie } });

    const remaining = await pool.query("SELECT 1 FROM conversations WHERE id = $1", [conversationId]);
    expect(remaining.rowCount).toBe(0);
  });
});
