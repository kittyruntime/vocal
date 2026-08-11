import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { hashToken } from "../auth/sessions.js";
import { requireCapability } from "../auth/guard.js";

const inviteIdSchema = z.object({ id: z.uuid() });

const createInviteSchema = z.object({ expiresInHours: z.number().int().min(1).max(24 * 30).default(24 * 7), maxUses: z.number().int().min(1).max(100).default(1) });

export function registerInviteRoutes(app: FastifyInstance, pool: pg.Pool): void {
  const guards = { preHandler: [app.requireAuth, requireCapability("manage_server")] };

  app.post("/api/invites", guards, async (req, reply) => {
    const body = createInviteSchema.safeParse(req.body ?? {}); if (!body.success) return reply.code(400).send({ error: "invalid invite settings" });
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + body.data.expiresInHours * 3600 * 1000);
    const res = await pool.query(
      `INSERT INTO invites (token_hash, created_by, expires_at, max_uses)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [hashToken(token), req.user!.id, expiresAt, body.data.maxUses],
    );
    return reply.code(201).send({ id: res.rows[0].id, token, expiresAt, maxUses: body.data.maxUses, useCount: 0 });
  });

  app.get("/api/invites", guards, async () => {
    const res = await pool.query(
      `SELECT id, created_by AS "createdBy", expires_at AS "expiresAt", used_by AS "usedBy", used_at AS "usedAt", created_at AS "createdAt",
              max_uses AS "maxUses", use_count AS "useCount", revoked_at AS "revokedAt"
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
