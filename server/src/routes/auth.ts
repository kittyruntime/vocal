import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import { createSession, deleteSession, hashToken } from "../auth/sessions.js";
import { CAPABILITIES } from "../capabilities.js";

// Precomputed once at module load so that an unknown-username login still
// pays the cost of an argon2 verify, keeping the response time close to a
// wrong-password login and avoiding a timing side-channel for username
// enumeration.
const DUMMY_HASH_PROMISE: Promise<string> = hashPassword("dummy-password-for-timing-normalization");
const USERNAME_PATTERN = /^[\p{L}\p{N}_.-]+$/u;

const credentialsSchema = z.object({
  username: z.string().min(2).max(32).regex(USERNAME_PATTERN),
  password: z.string().min(8).max(256),
});

// Login only checks a hash match, so it must not enforce the *creation-time*
// password-strength policy (min length) — a too-short guess is still just a
// wrong password (401), not a malformed request (400).
const loginSchema = z.object({
  username: z.string().min(2).max(32).regex(USERNAME_PATTERN),
  password: z.string().min(1).max(256),
});

const profileSchema = z.object({
  username: z.string().trim().min(2).max(32).regex(USERNAME_PATTERN),
  email: z.union([z.string().trim().email().max(254), z.literal(""), z.null()]).transform((value) => value || null),
  description: z.string().trim().max(190),
  avatarUrl: z.union([
    z.string().max(700_000).regex(/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/),
    z.null(),
  ]),
  bannerUrl: z.union([
    z.string().max(700_000).regex(/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/),
    z.null(),
  ]).optional(),
});
const userIdSchema = z.object({ id: z.uuid() });

function setSidCookie(reply: any, token: string, expiresAt: Date): void {
  reply.setCookie("sid", token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE !== "false",
    expires: expiresAt,
  });
}

export function registerAuthRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.get("/api/setup", async () => {
    const count = await pool.query("SELECT count(*)::int AS n FROM users");
    return { done: count.rows[0].n > 0 };
  });

  app.post("/api/setup", async (req, reply) => {
    const body = credentialsSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid payload" });
    const count = await pool.query("SELECT count(*)::int AS n FROM users");
    if (count.rows[0].n > 0) {
      return reply.code(403).send({ error: "setup already done" });
    }
    const hash = await hashPassword(body.data.password);
    const client = await pool.connect();
    let userId: string;
    try {
      await client.query("BEGIN");
      const res = await client.query(
        "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id",
        [body.data.username, hash],
      );
      userId = res.rows[0].id;
      for (const capability of CAPABILITIES) {
        await client.query(
          "INSERT INTO user_capabilities (user_id, capability) VALUES ($1, $2)",
          [userId, capability],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    const session = await createSession(pool, userId);
    setSidCookie(reply, session.token, session.expiresAt);
    return reply.code(201).send({ ok: true });
  });

  app.post("/api/auth/login", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid payload" });
    const res = await pool.query(
      "SELECT id, password_hash, banned_at FROM users WHERE username = $1",
      [body.data.username],
    );
    const row = res.rows[0];
    if (!row?.password_hash) {
      // No such user (or no password set yet): still run an argon2 verify
      // against a dummy hash so the response time doesn't reveal whether
      // the username exists.
      await verifyPassword(await DUMMY_HASH_PROMISE, body.data.password);
      return reply.code(401).send({ error: "invalid credentials" });
    }
    if (!(await verifyPassword(row.password_hash, body.data.password))) {
      return reply.code(401).send({ error: "invalid credentials" });
    }
    if (row.banned_at) {
      return reply.code(403).send({ error: "account banned" });
    }
    const session = await createSession(pool, row.id);
    setSidCookie(reply, session.token, session.expiresAt);
    return { ok: true };
  });

  app.post("/api/auth/register", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const schema = credentialsSchema.extend({ inviteToken: z.string().min(1).optional() });
    const body = schema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid payload" });
    const settings = await pool.query<{ registration_open: boolean }>("SELECT registration_open FROM server_settings WHERE singleton = true");
    if (settings.rows[0]?.registration_open === false && !body.data.inviteToken) {
      return reply.code(403).send({ error: "registration closed" });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let inviteId: string | undefined;
      if (body.data.inviteToken) {
        const invite = await client.query<{ id: string }>(
          `SELECT id FROM invites
           WHERE token_hash = $1 AND used_by IS NULL AND expires_at > now()
           FOR UPDATE`,
          [hashToken(body.data.inviteToken)],
        );
        if (!invite.rowCount) {
          await client.query("ROLLBACK");
          return reply.code(403).send({ error: "invalid or expired invite" });
        }
        inviteId = invite.rows[0].id;
      }
      const hash = await hashPassword(body.data.password);
      const user = await client.query(
        "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id",
        [body.data.username, hash],
      );
      await client.query(
        "INSERT INTO user_capabilities (user_id, capability) VALUES ($1, 'publish_voice')",
        [user.rows[0].id],
      );
      if (inviteId) {
        await client.query(
          "UPDATE invites SET used_by = $1, used_at = now() WHERE id = $2",
          [user.rows[0].id, inviteId],
        );
      }
      await client.query("COMMIT");
      const session = await createSession(pool, user.rows[0].id);
      setSidCookie(reply, session.token, session.expiresAt);
      return reply.code(201).send({ ok: true });
    } catch (err: any) {
      await client.query("ROLLBACK");
      if (err?.code === "23505") return reply.code(409).send({ error: "username taken" });
      throw err;
    } finally {
      client.release();
    }
  });

  app.post("/api/auth/logout", async (req, reply) => {
    if (req.cookies.sid) await deleteSession(pool, req.cookies.sid);
    reply.clearCookie("sid", { path: "/" });
    return { ok: true };
  });

  app.get("/api/me", { preHandler: app.requireAuth }, async (req) => req.user);

  app.get("/api/users/:id/avatar", { preHandler: app.requireAuth }, async (req, reply) => {
    const params = userIdSchema.safeParse(req.params);
    if (!params.success) return reply.code(404).send({ error: "avatar not found" });
    const result = await pool.query<{ avatar_url: string | null }>("SELECT avatar_url FROM users WHERE id = $1", [params.data.id]);
    const encoded = result.rows[0]?.avatar_url;
    const match = encoded?.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/);
    if (!match) return reply.code(404).send({ error: "avatar not found" });
    return reply
      .type(match[1])
      .header("Cache-Control", "private, no-cache")
      .send(Buffer.from(match[2], "base64"));
  });

  app.get("/api/users/:id/banner", { preHandler: app.requireAuth }, async (req, reply) => {
    const params = userIdSchema.safeParse(req.params);
    if (!params.success) return reply.code(404).send({ error: "banner not found" });
    const result = await pool.query<{ banner_url: string | null }>("SELECT banner_url FROM users WHERE id = $1", [params.data.id]);
    const encoded = result.rows[0]?.banner_url;
    const match = encoded?.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/);
    if (!match) return reply.code(404).send({ error: "banner not found" });
    return reply.type(match[1]).header("Cache-Control", "private, no-cache").send(Buffer.from(match[2], "base64"));
  });

  app.get("/api/users/:id/profile", { preHandler: app.requireAuth }, async (req, reply) => {
    const params = userIdSchema.safeParse(req.params);
    if (!params.success) return reply.code(404).send({ error: "user not found" });
    const result = await pool.query<{ id: string; username: string; description: string; avatar_url: string | null; banner_url: string | null }>(
      "SELECT id, username, description, avatar_url, banner_url FROM users WHERE id = $1 AND banned_at IS NULL",
      [params.data.id],
    );
    const user = result.rows[0];
    if (!user) return reply.code(404).send({ error: "user not found" });
    return {
      id: user.id,
      username: user.username,
      description: user.description,
      avatarUrl: user.avatar_url ? `/api/users/${user.id}/avatar` : null,
      bannerUrl: user.banner_url ? `/api/users/${user.id}/banner` : null,
    };
  });

  app.patch("/api/me", { preHandler: app.requireAuth }, async (req, reply) => {
    const body = profileSchema.safeParse(req.body);
    if (!body.success) {
      const field = body.error.issues[0]?.path[0];
      const labels: Record<string, string> = {
        username: "username",
        email: "email address",
        description: "description",
        avatarUrl: "profile picture",
        bannerUrl: "profile banner",
      };
      return reply.code(400).send({ error: `invalid ${labels[String(field)] ?? "profile"}` });
    }
    try {
      const updated = await pool.query(
        `UPDATE users
         SET username = $1, email = $2, avatar_url = $3, description = $4, banner_url = $5
         WHERE id = $6
         RETURNING username, email, avatar_url AS "avatarUrl", banner_url AS "bannerUrl", description`,
        [body.data.username, body.data.email, body.data.avatarUrl, body.data.description, body.data.bannerUrl ?? req.user!.bannerUrl, req.user!.id],
      );
      return { ...req.user!, ...updated.rows[0] };
    } catch (err: any) {
      if (err?.code === "23505") {
        const emailConflict = String(err.constraint ?? "").includes("email");
        return reply.code(409).send({ error: emailConflict ? "email already used" : "username taken" });
      }
      throw err;
    }
  });
}
