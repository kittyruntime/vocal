import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { hashToken } from "../auth/sessions.js";
import { requireCapability } from "../auth/guard.js";

const inviteIdSchema = z.object({ id: z.uuid() });

const INVITE_DAYS = 7;

export function registerInviteRoutes(app: FastifyInstance, pool: pg.Pool): void {
  const guards = { preHandler: [app.requireAuth, requireCapability("manage_server")] };

  app.post("/api/invites", guards, async (req, reply) => {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 3600 * 1000);
    const res = await pool.query(
      `INSERT INTO invites (token_hash, created_by, expires_at)
       VALUES ($1, $2, $3) RETURNING id`,
      [hashToken(token), req.user!.id, expiresAt],
    );
    return reply.code(201).send({ id: res.rows[0].id, token, expiresAt });
  });

  app.get("/api/invites", guards, async () => {
    const res = await pool.query(
      `SELECT id, created_by, expires_at, used_by, used_at, created_at
       FROM invites ORDER BY created_at DESC`,
    );
    return res.rows;
  });

  app.delete("/api/invites/:id", guards, async (req, reply) => {
    const params = inviteIdSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid invite id" });
    await pool.query("DELETE FROM invites WHERE id = $1", [params.data.id]);
    return reply.code(204).send();
  });
}
