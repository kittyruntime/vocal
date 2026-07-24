import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import { createSession, deleteSession, hashToken } from "../auth/sessions.js";

const credentialsSchema = z.object({
  username: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_.-]+$/),
  password: z.string().min(8).max(256),
});

// Login only checks a hash match, so it must not enforce the *creation-time*
// password-strength policy (min length) — a too-short guess is still just a
// wrong password (401), not a malformed request (400).
const loginSchema = z.object({
  username: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_.-]+$/),
  password: z.string().min(1).max(256),
});

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
  app.post("/api/setup", async (req, reply) => {
    const body = credentialsSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid payload" });
    const count = await pool.query("SELECT count(*)::int AS n FROM users");
    if (count.rows[0].n > 0) {
      return reply.code(403).send({ error: "setup already done" });
    }
    const hash = await hashPassword(body.data.password);
    const res = await pool.query(
      "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin') RETURNING id",
      [body.data.username, hash],
    );
    const session = await createSession(pool, res.rows[0].id);
    setSidCookie(reply, session.token, session.expiresAt);
    return reply.code(201).send({ ok: true });
  });

  app.post("/api/auth/login", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid payload" });
    const res = await pool.query(
      "SELECT id, password_hash FROM users WHERE username = $1",
      [body.data.username],
    );
    const row = res.rows[0];
    if (!row?.password_hash || !(await verifyPassword(row.password_hash, body.data.password))) {
      return reply.code(401).send({ error: "invalid credentials" });
    }
    const session = await createSession(pool, row.id);
    setSidCookie(reply, session.token, session.expiresAt);
    return { ok: true };
  });

  app.post("/api/auth/register", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const schema = credentialsSchema.extend({ inviteToken: z.string().min(1) });
    const body = schema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid payload" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const invite = await client.query(
        `SELECT id FROM invites
         WHERE token_hash = $1 AND used_by IS NULL AND expires_at > now()
         FOR UPDATE`,
        [hashToken(body.data.inviteToken)],
      );
      if (!invite.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(403).send({ error: "invalid or expired invite" });
      }
      const hash = await hashPassword(body.data.password);
      const user = await client.query(
        "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id",
        [body.data.username, hash],
      );
      await client.query(
        "UPDATE invites SET used_by = $1, used_at = now() WHERE id = $2",
        [user.rows[0].id, invite.rows[0].id],
      );
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
}
