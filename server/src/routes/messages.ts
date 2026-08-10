import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { createMessage, listMessages } from "../messages/store.js";
import type { WsHub } from "../ws/hub.js";
import { channelRequiredCapability } from "../channels/lookup.js";

const idSchema = z.object({ id: z.uuid() });
const postSchema = z.object({ content: z.string().min(1).max(4000) });
const querySchema = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export function registerMessageRoutes(
  app: FastifyInstance, pool: pg.Pool, key: Buffer, hub: WsHub,
): void {
  app.post("/api/channels/:id/messages", { preHandler: app.requireAuth }, async (req: FastifyRequest, reply) => {
    const params = idSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid channel id" });
    const body = postSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid payload" });
    const requiredCapability = await channelRequiredCapability(pool, params.data.id);
    if (requiredCapability === undefined) return reply.code(404).send({ error: "channel not found" });
    if (requiredCapability !== null && !req.user!.capabilities.includes(requiredCapability)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const message = await createMessage(pool, key, {
      channelId: params.data.id, userId: req.user!.id, content: body.data.content,
    });
    hub.broadcastToCapability(requiredCapability, { type: "message.created", message });
    return reply.code(201).send(message);
  });

  app.get("/api/channels/:id/messages", { preHandler: app.requireAuth }, async (req: FastifyRequest, reply) => {
    const params = idSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid channel id" });
    const query = querySchema.safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: "invalid query" });
    const requiredCapability = await channelRequiredCapability(pool, params.data.id);
    if (requiredCapability === undefined) return reply.code(404).send({ error: "channel not found" });
    if (requiredCapability !== null && !req.user!.capabilities.includes(requiredCapability)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    return listMessages(pool, key, {
      channelId: params.data.id, before: query.data.before, limit: query.data.limit,
    });
  });
}
