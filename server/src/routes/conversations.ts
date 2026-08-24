import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { createMessage, getMessage, listMessages, setMessageReaction, updateMessageContent } from "../messages/store.js";
import { attachmentsWithinLimits, loadMessageLimits, parseMessageBody } from "../messages/parseBody.js";
import {
  addParticipant, createDirectMessage, createGroup, getConversation, isParticipant,
  listConversationsForUser, participantUserIds, removeParticipant, renameConversation,
} from "../conversations/store.js";
import type { WsHub } from "../ws/hub.js";

const idSchema = z.object({ id: z.uuid() });
const messageParamsSchema = z.object({ id: z.uuid(), messageId: z.uuid() });
const participantParamsSchema = z.object({ id: z.uuid(), userId: z.uuid() });
const reactionSchema = z.object({ emoji: z.string().min(1).max(16) });
const querySchema = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
const createSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("dm"), userId: z.uuid() }),
  z.object({ type: z.literal("group"), participantIds: z.array(z.uuid()).min(1), name: z.string().min(1).max(64).optional() }),
]);
const renameSchema = z.object({ name: z.string().min(1).max(64) });

export function registerConversationRoutes(app: FastifyInstance, pool: pg.Pool, key: Buffer, hub: WsHub): void {
  app.get("/api/conversations", { preHandler: app.requireAuth }, async (req) => {
    return listConversationsForUser(pool, req.user!.id);
  });

  app.post("/api/conversations", { preHandler: app.requireAuth }, async (req, reply) => {
    const body = createSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid payload" });
    const conversation = body.data.type === "dm"
      ? await createDirectMessage(pool, req.user!.id, body.data.userId)
      : await createGroup(pool, req.user!.id, body.data.participantIds, body.data.name ?? null);
    if (!conversation) return reply.code(400).send({ error: "cannot start a conversation with yourself" });
    hub.sendToUsers(conversation.participants.map((p) => p.userId), { type: "conversation.created", conversation });
    return reply.code(201).send(conversation);
  });

  app.patch("/api/conversations/:id", { preHandler: app.requireAuth }, async (req: FastifyRequest, reply) => {
    const params = idSchema.safeParse(req.params);
    const body = renameSchema.safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid payload" });
    if (!(await isParticipant(pool, params.data.id, req.user!.id))) return reply.code(404).send({ error: "conversation not found" });
    const conversation = await renameConversation(pool, params.data.id, body.data.name);
    if (!conversation) return reply.code(400).send({ error: "only group conversations can be renamed" });
    hub.sendToUsers(conversation.participants.map((p) => p.userId), { type: "conversation.updated", conversation });
    return conversation;
  });

  app.post("/api/conversations/:id/participants", { preHandler: app.requireAuth }, async (req: FastifyRequest, reply) => {
    const params = idSchema.safeParse(req.params);
    const body = z.object({ userId: z.uuid() }).safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid payload" });
    if (!(await isParticipant(pool, params.data.id, req.user!.id))) return reply.code(404).send({ error: "conversation not found" });
    const conversation = await addParticipant(pool, params.data.id, body.data.userId);
    if (!conversation) return reply.code(400).send({ error: "cannot add participants to a direct message" });
    hub.sendToUsers(conversation.participants.map((p) => p.userId), { type: "conversation.updated", conversation });
    return conversation;
  });

  app.delete("/api/conversations/:id/participants/:userId", { preHandler: app.requireAuth }, async (req: FastifyRequest, reply) => {
    const params = participantParamsSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid payload" });
    if (!(await isParticipant(pool, params.data.id, req.user!.id))) return reply.code(404).send({ error: "conversation not found" });
    const before = await getConversation(pool, params.data.id);
    if (before?.type !== "group") return reply.code(400).send({ error: "cannot remove participants from a direct message" });
    await removeParticipant(pool, params.data.id, params.data.userId);
    const allUserIds = before?.participants.map((p) => p.userId) ?? [];
    hub.sendToUsers([params.data.userId], { type: "conversation.removed", conversationId: params.data.id });
    const after = await getConversation(pool, params.data.id);
    if (after) hub.sendToUsers(allUserIds.filter((id) => id !== params.data.userId), { type: "conversation.updated", conversation: after });
    return reply.code(204).send();
  });

  app.get("/api/conversations/:id/messages", { preHandler: app.requireAuth }, async (req: FastifyRequest, reply) => {
    const params = idSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid conversation id" });
    const query = querySchema.safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: "invalid query" });
    if (!(await isParticipant(pool, params.data.id, req.user!.id))) return reply.code(404).send({ error: "conversation not found" });
    return listMessages(pool, key, { conversationId: params.data.id, before: query.data.before, limit: query.data.limit });
  });

  app.post("/api/conversations/:id/messages", { preHandler: app.requireAuth }, async (req: FastifyRequest, reply) => {
    const params = idSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid conversation id" });
    if (!(await isParticipant(pool, params.data.id, req.user!.id))) return reply.code(404).send({ error: "conversation not found" });
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
      const target = await pool.query<{ conversation_id: string }>("SELECT conversation_id FROM messages WHERE id = $1", [parsed.replyToMessageId]);
      if (target.rows[0]?.conversation_id !== params.data.id) return reply.code(400).send({ error: "invalid reply target" });
    }
    const message = await createMessage(pool, key, {
      conversationId: params.data.id, userId: req.user!.id, content: parsed.content, attachments: parsed.attachments, replyToMessageId: parsed.replyToMessageId,
    });
    hub.sendToUsers(await participantUserIds(pool, params.data.id), { type: "message.created", message });
    return reply.code(201).send(message);
  });

  app.patch("/api/conversations/:id/messages/:messageId", { preHandler: app.requireAuth }, async (req: FastifyRequest, reply) => {
    const params = messageParamsSchema.safeParse(req.params);
    const body = z.object({ content: z.string().trim().min(1).max(10000) }).safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid payload" });
    const owner = await isMessageOwner(pool, params.data.id, params.data.messageId, req.user!.id);
    if (owner === "missing") return reply.code(404).send({ error: "message not found" });
    if (!owner) return reply.code(403).send({ error: "only the author can edit this message" });
    const updated = await updateMessageContent(pool, key, params.data.messageId, body.data.content);
    hub.sendToUsers(await participantUserIds(pool, params.data.id), { type: "message.updated", message: updated! });
    return updated;
  });

  app.delete("/api/conversations/:id/messages/:messageId", { preHandler: app.requireAuth }, async (req: FastifyRequest, reply) => {
    const params = messageParamsSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid message id" });
    const owner = await isMessageOwner(pool, params.data.id, params.data.messageId, req.user!.id);
    if (owner === "missing") return reply.code(404).send({ error: "message not found" });
    if (!owner) return reply.code(403).send({ error: "forbidden" });
    const participants = await participantUserIds(pool, params.data.id);
    await pool.query("DELETE FROM messages WHERE id = $1", [params.data.messageId]);
    hub.sendToUsers(participants, { type: "message.deleted", conversationId: params.data.id, messageId: params.data.messageId });
    return reply.code(204).send();
  });

  for (const method of ["PUT", "DELETE"] as const) app.route({
    method,
    url: "/api/conversations/:id/messages/:messageId/reactions",
    preHandler: app.requireAuth,
    handler: async (req: FastifyRequest, reply) => {
      const params = messageParamsSchema.safeParse(req.params);
      const body = reactionSchema.safeParse(req.body);
      if (!params.success || !body.success) return reply.code(400).send({ error: "invalid reaction" });
      if (!(await isParticipant(pool, params.data.id, req.user!.id))) return reply.code(404).send({ error: "message not found" });
      const message = await getMessage(pool, key, params.data.messageId);
      if (!message || message.conversationId !== params.data.id) return reply.code(404).send({ error: "message not found" });
      const updated = await setMessageReaction(pool, key, params.data.messageId, req.user!.id, body.data.emoji, method === "PUT");
      hub.sendToUsers(await participantUserIds(pool, params.data.id), { type: "message.updated", message: updated! });
      return updated;
    },
  });
}

async function isMessageOwner(pool: pg.Pool, conversationId: string, messageId: string, userId: string): Promise<boolean | "missing"> {
  const result = await pool.query<{ user_id: string }>(
    "SELECT user_id FROM messages WHERE id = $1 AND conversation_id = $2", [messageId, conversationId],
  );
  const row = result.rows[0];
  if (!row) return "missing";
  return row.user_id === userId;
}
