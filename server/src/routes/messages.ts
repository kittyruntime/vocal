import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { createMessage, getMessage, listMessages, setMessageReaction, updateMessageContent } from "../messages/store.js";
import { attachmentsWithinLimits, loadMessageLimits, parseMessageBody } from "../messages/parseBody.js";
import type { WsHub } from "../ws/hub.js";
import { channelRequiredCapability } from "../channels/lookup.js";
import type { Capability } from "../capabilities.js";

// MIME types safe to render inline in the browser. Deliberately NOT just
// "starts with image/": image/svg+xml is an XML document that can carry
// <script> and event-handler attributes -- browsers execute those when the
// SVG is opened as a top-level document (e.g. the "open in new tab" link
// the web client puts on image attachments), which would be a stored XSS
// on this app's own origin using an attacker-controlled, client-supplied
// MIME type. Anything outside this allowlist (including SVG) is always
// served as a forced download instead.
const INLINE_SAFE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);

const idSchema = z.object({ id: z.uuid() });
const messageParamsSchema = z.object({ id: z.uuid(), messageId: z.uuid() });
const reactionSchema = z.object({ emoji: z.string().min(1).max(16) });
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
    const requiredCapability = await channelRequiredCapability(pool, params.data.id);
    if (requiredCapability === undefined) return reply.code(404).send({ error: "channel not found" });
    if (requiredCapability !== null && !req.user!.capabilities.includes(requiredCapability)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const parsed = await parseMessageBody(req);
    if (!parsed.ok) return reply.code(parsed.status).send({ error: parsed.error });
    const limits = await loadMessageLimits(pool);
    if (parsed.content.length > limits.maxMessageLength) {
      return reply.code(413).send({ error: `message exceeds the ${limits.maxMessageLength} character limit` });
    }
    if (!attachmentsWithinLimits(parsed.attachments, limits)) {
      return reply.code(413).send({ error: "attachment exceeds the configured limit" });
    }
    if (parsed.replyToMessageId) {
      const target = await pool.query<{ channel_id: string }>("SELECT channel_id FROM messages WHERE id = $1", [parsed.replyToMessageId]);
      if (target.rows[0]?.channel_id !== params.data.id) return reply.code(400).send({ error: "invalid reply target" });
    }
    const message = await createMessage(pool, key, {
      channelId: params.data.id, userId: req.user!.id, content: parsed.content, attachments: parsed.attachments, replyToMessageId: parsed.replyToMessageId,
    });
    hub.broadcastToCapability(requiredCapability, { type: "message.created", message });
    return reply.code(201).send(message);
  });

  app.get("/api/attachments/:id", { preHandler: app.requireAuth }, async (req, reply) => {
    const params = idSchema.safeParse(req.params);
    if (!params.success) return reply.code(404).send({ error: "attachment not found" });
    const result = await pool.query<{
      filename: string; mime_type: string; content: Buffer;
      required_capability: Capability | null; conversation_id: string | null; is_participant: boolean;
    }>(
      `SELECT a.filename, a.mime_type, a.content, c.required_capability, m.conversation_id,
              EXISTS (SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id = m.conversation_id AND cp.user_id = $2) AS is_participant
       FROM message_attachments a
       JOIN messages m ON m.id = a.message_id
       LEFT JOIN channels c ON c.id = m.channel_id
       WHERE a.id = $1`,
      [params.data.id, req.user!.id],
    );
    const attachment = result.rows[0];
    if (!attachment) return reply.code(404).send({ error: "attachment not found" });
    if (attachment.conversation_id) {
      if (!attachment.is_participant) return reply.code(403).send({ error: "forbidden" });
    } else if (attachment.required_capability && !req.user!.capabilities.includes(attachment.required_capability)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const disposition = INLINE_SAFE_MIME_TYPES.has(attachment.mime_type) ? "inline" : "attachment";
    return reply
      .type(attachment.mime_type)
      .header("Content-Disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`)
      .header("Cache-Control", "private, max-age=3600")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; sandbox")
      .send(attachment.content);
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

  app.patch("/api/channels/:id/messages/:messageId", { preHandler: app.requireAuth }, async (req: FastifyRequest, reply) => {
    const params = messageParamsSchema.safeParse(req.params);
    const body = z.object({ content: z.string().trim().min(1).max(10000) }).safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid payload" });
    const access = await messageAccess(pool, params.data.id, params.data.messageId, req.user!.id, req.user!.capabilities);
    if (access === "missing") return reply.code(404).send({ error: "message not found" });
    if (access.kind !== "owner") return reply.code(403).send({ error: "only the author can edit this message" });
    const updated = await updateMessageContent(pool, key, params.data.messageId, body.data.content);
    hub.broadcastToCapability(access.requiredCapability, { type: "message.updated", message: updated! });
    return updated;
  });

  app.delete("/api/channels/:id/messages/:messageId", { preHandler: app.requireAuth }, async (req: FastifyRequest, reply) => {
    const params = messageParamsSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid message id" });
    const access = await messageAccess(pool, params.data.id, params.data.messageId, req.user!.id, req.user!.capabilities);
    if (access === "missing") return reply.code(404).send({ error: "message not found" });
    if (access.kind !== "owner" && access.kind !== "moderator") return reply.code(403).send({ error: "forbidden" });
    await pool.query("DELETE FROM messages WHERE id = $1", [params.data.messageId]);
    hub.broadcastToCapability(access.requiredCapability, { type: "message.deleted", channelId: params.data.id, messageId: params.data.messageId });
    return reply.code(204).send();
  });

  for (const method of ["PUT", "DELETE"] as const) app.route({
    method,
    url: "/api/channels/:id/messages/:messageId/reactions",
    preHandler: app.requireAuth,
    handler: async (req: FastifyRequest, reply) => {
      const params = messageParamsSchema.safeParse(req.params);
      const body = reactionSchema.safeParse(req.body);
      if (!params.success || !body.success) return reply.code(400).send({ error: "invalid reaction" });
      const access = await messageAccess(pool, params.data.id, params.data.messageId, req.user!.id, req.user!.capabilities);
      if (access === "missing") return reply.code(404).send({ error: "message not found" });
      const updated = await setMessageReaction(pool, key, params.data.messageId, req.user!.id, body.data.emoji, method === "PUT");
      hub.broadcastToCapability(access.requiredCapability, { type: "message.updated", message: updated! });
      return updated;
    },
  });
}

async function messageAccess(pool: pg.Pool, channelId: string, messageId: string, userId: string, capabilities: Capability[]) {
  const result = await pool.query<{ user_id: string; required_capability: Capability | null }>(
    `SELECT m.user_id, c.required_capability FROM messages m JOIN channels c ON c.id = m.channel_id
     WHERE m.id = $1 AND m.channel_id = $2`, [messageId, channelId],
  );
  const row = result.rows[0];
  if (!row || (row.required_capability && !capabilities.includes(row.required_capability))) return "missing" as const;
  if (row.user_id === userId) return { requiredCapability: row.required_capability, kind: "owner" as const };
  if (capabilities.includes("moderate")) return { requiredCapability: row.required_capability, kind: "moderator" as const };
  return { requiredCapability: row.required_capability, kind: "member" as const };
}
