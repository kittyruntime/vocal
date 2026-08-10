import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { createMessage, listMessages } from "../messages/store.js";
import type { NewAttachment } from "../messages/store.js";
import type { WsHub } from "../ws/hub.js";
import { channelRequiredCapability } from "../channels/lookup.js";
import type { Capability } from "../capabilities.js";

const idSchema = z.object({ id: z.uuid() });
const postSchema = z.object({ content: z.string().max(4000) });
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
    let content = "";
    const attachments: NewAttachment[] = [];
    if (req.isMultipart()) {
      try {
        for await (const part of req.parts()) {
          if (part.type === "field") {
            if (part.fieldname === "content" && typeof part.value === "string") content = part.value;
            continue;
          }
          const buffer = await part.toBuffer();
          const filename = part.filename.replace(/^.*[\\/]/, "").slice(0, 255) || "attachment";
          attachments.push({ filename, mimeType: part.mimetype || "application/octet-stream", content: buffer });
        }
      } catch (error: any) {
        if (error?.code === "FST_REQ_FILE_TOO_LARGE" || error?.code === "FST_FILES_LIMIT") {
          return reply.code(413).send({ error: "attachment exceeds the server limit" });
        }
        throw error;
      }
    } else {
      const body = postSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "invalid payload" });
      content = body.data.content;
    }
    const parsedContent = postSchema.safeParse({ content });
    if (!parsedContent.success || (content.trim().length === 0 && attachments.length === 0)) {
      return reply.code(400).send({ error: "message cannot be empty" });
    }
    const settings = await pool.query<{ max_image_size_mb: number; max_file_size_mb: number }>(
      "SELECT max_image_size_mb, max_file_size_mb FROM server_settings WHERE singleton = true",
    );
    const maxImageBytes = (settings.rows[0]?.max_image_size_mb ?? 5) * 1024 * 1024;
    const maxFileBytes = (settings.rows[0]?.max_file_size_mb ?? 10) * 1024 * 1024;
    for (const attachment of attachments) {
      const isImage = attachment.mimeType.startsWith("image/");
      if (attachment.content.length > (isImage ? maxImageBytes : maxFileBytes)) {
        return reply.code(413).send({ error: `${isImage ? "image" : "file"} exceeds the configured limit` });
      }
    }
    const message = await createMessage(pool, key, {
      channelId: params.data.id, userId: req.user!.id, content: parsedContent.data.content.trim(), attachments,
    });
    hub.broadcastToCapability(requiredCapability, { type: "message.created", message });
    return reply.code(201).send(message);
  });

  app.get("/api/attachments/:id", { preHandler: app.requireAuth }, async (req, reply) => {
    const params = idSchema.safeParse(req.params);
    if (!params.success) return reply.code(404).send({ error: "attachment not found" });
    const result = await pool.query<{
      filename: string; mime_type: string; content: Buffer; required_capability: Capability | null;
    }>(
      `SELECT a.filename, a.mime_type, a.content, c.required_capability
       FROM message_attachments a
       JOIN messages m ON m.id = a.message_id
       JOIN channels c ON c.id = m.channel_id
       WHERE a.id = $1`,
      [params.data.id],
    );
    const attachment = result.rows[0];
    if (!attachment) return reply.code(404).send({ error: "attachment not found" });
    if (attachment.required_capability && !req.user!.capabilities.includes(attachment.required_capability)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const disposition = attachment.mime_type.startsWith("image/") ? "inline" : "attachment";
    return reply
      .type(attachment.mime_type)
      .header("Content-Disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`)
      .header("Cache-Control", "private, max-age=3600")
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
}
