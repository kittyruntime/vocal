import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import { makeTestDb } from "./helpers/db.js";
import { buildApp } from "../src/app.js";

let pool: pg.Pool;
let app: FastifyInstance;
let adminCookie: string;
let channelId: string;

function multipartBody(fields: Record<string, string>, file: { name: string; type: string; content: Buffer }) {
  const boundary = "----vocal-test-boundary";
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`));
  chunks.push(file.content, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function login(username: string, password: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/auth/login",
    payload: { username, password } });
  return `sid=${res.cookies.find((c) => c.name === "sid")!.value}`;
}

beforeAll(async () => {
  process.env.MESSAGE_MASTER_KEY ??= Buffer.alloc(32, 7).toString("base64");
  pool = await makeTestDb();
  ({ app } = await buildApp({ pool }));
});
afterAll(async () => { await app.close(); await pool.end(); });

beforeEach(async () => {
  await pool.query("TRUNCATE users, sessions, invites, channels, messages CASCADE");
  await app.inject({ method: "POST", url: "/api/setup",
    payload: { username: "theo", password: "correct horse battery" } });
  adminCookie = await login("theo", "correct horse battery");
  const ch = await app.inject({ method: "POST", url: "/api/channels",
    headers: { cookie: adminCookie }, payload: { name: "général", type: "text" } });
  channelId = ch.json().id;
});

describe("messages", () => {
  it("posts a message and returns the decrypted payload", async () => {
    const res = await app.inject({ method: "POST", url: `/api/channels/${channelId}/messages`,
      headers: { cookie: adminCookie }, payload: { content: "salut 👋" } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ content: "salut 👋", channelId, username: "theo" });
  });

  it("stores the content encrypted at rest", async () => {
    await app.inject({ method: "POST", url: `/api/channels/${channelId}/messages`,
      headers: { cookie: adminCookie }, payload: { content: "secret message" } });
    const raw = await pool.query("SELECT content_encrypted FROM messages LIMIT 1");
    expect(raw.rows[0].content_encrypted).not.toContain("secret message");
    expect(raw.rows[0].content_encrypted).toMatch(/^v1:/);
  });

  it("uploads, lists and serves an image attachment", async () => {
    const upload = multipartBody({ content: "a picture" }, { name: "hello.png", type: "image/png", content: Buffer.from("fake-png") });
    const posted = await app.inject({
      method: "POST", url: `/api/channels/${channelId}/messages`,
      headers: { cookie: adminCookie, "content-type": upload.contentType }, payload: upload.payload,
    });
    expect(posted.statusCode).toBe(201);
    expect(posted.json().attachments).toMatchObject([{ filename: "hello.png", mimeType: "image/png", size: 8 }]);

    const history = await app.inject({ method: "GET", url: `/api/channels/${channelId}/messages`, headers: { cookie: adminCookie } });
    const attachment = history.json()[0].attachments[0];
    expect(attachment.filename).toBe("hello.png");
    const downloaded = await app.inject({ method: "GET", url: attachment.url, headers: { cookie: adminCookie } });
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.headers["content-type"]).toContain("image/png");
    expect(downloaded.rawPayload).toEqual(Buffer.from("fake-png"));
  });

  it("returns history most-recent-first and paginates with before", async () => {
    for (const n of ["m1", "m2", "m3"]) {
      await app.inject({ method: "POST", url: `/api/channels/${channelId}/messages`,
        headers: { cookie: adminCookie }, payload: { content: n } });
    }
    const page1 = await app.inject({ method: "GET",
      url: `/api/channels/${channelId}/messages?limit=2`, headers: { cookie: adminCookie } });
    const list1 = page1.json();
    expect(list1.map((m: { content: string }) => m.content)).toEqual(["m3", "m2"]);
    const before = list1[list1.length - 1].createdAt;
    const page2 = await app.inject({ method: "GET",
      url: `/api/channels/${channelId}/messages?limit=2&before=${encodeURIComponent(before)}`,
      headers: { cookie: adminCookie } });
    expect(page2.json().map((m: { content: string }) => m.content)).toEqual(["m1"]);
  });

  it("rejects empty content", async () => {
    const res = await app.inject({ method: "POST", url: `/api/channels/${channelId}/messages`,
      headers: { cookie: adminCookie }, payload: { content: "" } });
    expect(res.statusCode).toBe(400);
  });

  it("enforces the configured message length", async () => {
    await pool.query("UPDATE server_settings SET max_message_length = 100 WHERE singleton = true");
    const res = await app.inject({ method: "POST", url: `/api/channels/${channelId}/messages`,
      headers: { cookie: adminCookie }, payload: { content: "x".repeat(101) } });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ error: "message exceeds the 100 character limit" });
  });

  it("404 on posting to a nonexistent channel", async () => {
    const res = await app.inject({ method: "POST",
      url: "/api/channels/00000000-0000-0000-0000-000000000000/messages",
      headers: { cookie: adminCookie }, payload: { content: "x" } });
    expect(res.statusCode).toBe(404);
  });

  it("forbids a member from posting in a moderator-only channel", async () => {
    const staff = await app.inject({ method: "POST", url: "/api/channels",
      headers: { cookie: adminCookie }, payload: { name: "staff", type: "text", requiredCapability: "moderate" } });
    const staffId = staff.json().id;
    const inv = await app.inject({ method: "POST", url: "/api/invites", headers: { cookie: adminCookie } });
    const reg = await app.inject({ method: "POST", url: "/api/auth/register",
      payload: { inviteToken: inv.json().token, username: "alice", password: "alicepass123" } });
    const memberCookie = `sid=${reg.cookies.find((c) => c.name === "sid")!.value}`;
    const res = await app.inject({ method: "POST", url: `/api/channels/${staffId}/messages`,
      headers: { cookie: memberCookie }, payload: { content: "hi" } });
    expect(res.statusCode).toBe(403);
  });

  it("forbids a member from reading messages in a moderator-only channel", async () => {
    const staff = await app.inject({ method: "POST", url: "/api/channels",
      headers: { cookie: adminCookie }, payload: { name: "staff", type: "text", requiredCapability: "moderate" } });
    const staffId = staff.json().id;
    const inv = await app.inject({ method: "POST", url: "/api/invites", headers: { cookie: adminCookie } });
    const reg = await app.inject({ method: "POST", url: "/api/auth/register",
      payload: { inviteToken: inv.json().token, username: "alice", password: "alicepass123" } });
    const memberCookie = `sid=${reg.cookies.find((c) => c.name === "sid")!.value}`;
    const res = await app.inject({ method: "GET", url: `/api/channels/${staffId}/messages`,
      headers: { cookie: memberCookie } });
    expect(res.statusCode).toBe(403);
  });

  it("404 on reading messages of a nonexistent channel", async () => {
    const res = await app.inject({ method: "GET",
      url: "/api/channels/00000000-0000-0000-0000-000000000000/messages",
      headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(404);
  });
});
