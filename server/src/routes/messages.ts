import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { hasAtLeastRole, type Role } from "../roles.js";
import { createMessage, listMessages } from "../messages/store.js";
import type { WsHub } from "../ws/hub.js";

const idSchema = z.object({ id: z.uuid() });
const postSchema = z.object({ content: z.string().min(1).max(4000) });
const querySchema = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// Returns the channel's min_role, or null if the channel doesn't exist.
async function channelMinRole(pool: pg.Pool, channelId: string): Promise<Role | null> {
  const res = await pool.query<{ min_role: string }>(
    "SELECT min_role FROM channels WHERE id = $1", [channelId],
  );
  return (res.rows[0]?.min_role as Role | undefined) ?? null;
}

export function registerMessageRoutes(
  app: FastifyInstance, pool: pg.Pool, key: Buffer, hub: WsHub,
): void {
  app.post("/api/channels/:id/messages", { preHandler: app.requireAuth }, async (req: FastifyRequest, reply) => {
    const params = idSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid channel id" });
    const body = postSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid payload" });
    const minRole = await channelMinRole(pool, params.data.id);
    if (minRole === null) return reply.code(404).send({ error: "channel not found" });
    if (!hasAtLeastRole(req.user!.role as Role, minRole)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const message = await createMessage(pool, key, {
      channelId: params.data.id, userId: req.user!.id, content: body.data.content,
    });
    hub.broadcastToRole(minRole, { type: "message.created", message });
    return reply.code(201).send(message);
  });

  app.get("/api/channels/:id/messages", { preHandler: app.requireAuth }, async (req: FastifyRequest, reply) => {
    const params = idSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid channel id" });
    const query = querySchema.safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: "invalid query" });
    const minRole = await channelMinRole(pool, params.data.id);
    if (minRole === null) return reply.code(404).send({ error: "channel not found" });
    if (!hasAtLeastRole(req.user!.role as Role, minRole)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    return listMessages(pool, key, {
      channelId: params.data.id, before: query.data.before, limit: query.data.limit,
    });
  });
}
