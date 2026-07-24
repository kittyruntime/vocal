import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { hasAtLeastRole, type Role } from "../roles.js";

const createSchema = z.object({
  name: z.string().min(1).max(64),
  type: z.enum(["text", "voice"]),
  minRole: z.enum(["admin", "moderator", "member"]).default("member"),
});

const idSchema = z.object({ id: z.uuid() });

async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (req.user?.role !== "admin") {
    await reply.code(403).send({ error: "admin only" });
  }
}

type ChannelRow = {
  id: string; name: string; type: string; min_role: string;
  position: number; created_at: Date;
};

function toChannel(row: ChannelRow) {
  return {
    id: row.id, name: row.name, type: row.type, minRole: row.min_role,
    position: row.position, createdAt: row.created_at,
  };
}

export function registerChannelRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.post("/api/channels", { preHandler: [app.requireAuth, requireAdmin] }, async (req, reply) => {
    const body = createSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid payload" });
    const { name, type, minRole } = body.data;
    const res = await pool.query<ChannelRow>(
      `INSERT INTO channels (name, type, min_role) VALUES ($1, $2, $3)
       RETURNING id, name, type, min_role, position, created_at`,
      [name, type, minRole],
    );
    return reply.code(201).send(toChannel(res.rows[0]));
  });

  app.get("/api/channels", { preHandler: app.requireAuth }, async (req) => {
    const res = await pool.query<ChannelRow>(
      `SELECT id, name, type, min_role, position, created_at
       FROM channels ORDER BY position, created_at`,
    );
    const role = req.user!.role as Role;
    return res.rows
      .filter((row) => hasAtLeastRole(role, row.min_role as Role))
      .map(toChannel);
  });

  app.delete("/api/channels/:id", { preHandler: [app.requireAuth, requireAdmin] }, async (req, reply) => {
    const params = idSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid channel id" });
    await pool.query("DELETE FROM channels WHERE id = $1", [params.data.id]);
    return reply.code(204).send();
  });
}
