import type { FastifyRequest } from "fastify";
import type pg from "pg";
import { z } from "zod";
import type { NewAttachment } from "./store.js";

const postSchema = z.object({ content: z.string().max(10000), replyToMessageId: z.uuid().optional() });

export type ParsedMessageBody =
  | { ok: true; content: string; replyToMessageId?: string; attachments: NewAttachment[] }
  | { ok: false; status: number; error: string };

// Shared by both channel and conversation message-creation routes: accepts
// either a plain JSON body or a multipart form (for attachments).
export async function parseMessageBody(req: FastifyRequest): Promise<ParsedMessageBody> {
  let content = "";
  let replyToMessageId: string | undefined;
  const attachments: NewAttachment[] = [];
  if (req.isMultipart()) {
    try {
      for await (const part of req.parts()) {
        if (part.type === "field") {
          if (part.fieldname === "content" && typeof part.value === "string") content = part.value;
          if (part.fieldname === "replyToMessageId" && typeof part.value === "string") replyToMessageId = part.value;
          continue;
        }
        const buffer = await part.toBuffer();
        const filename = part.filename.replace(/^.*[\\/]/, "").slice(0, 255) || "attachment";
        attachments.push({ filename, mimeType: part.mimetype || "application/octet-stream", content: buffer });
      }
    } catch (error: any) {
      if (error?.code === "FST_REQ_FILE_TOO_LARGE" || error?.code === "FST_FILES_LIMIT") {
        return { ok: false, status: 413, error: "attachment exceeds the server limit" };
      }
      throw error;
    }
  } else {
    const body = postSchema.safeParse(req.body);
    if (!body.success) return { ok: false, status: 400, error: "invalid payload" };
    content = body.data.content;
    replyToMessageId = body.data.replyToMessageId;
  }
  const parsedContent = postSchema.safeParse({ content, replyToMessageId });
  if (!parsedContent.success || (content.trim().length === 0 && attachments.length === 0)) {
    return { ok: false, status: 400, error: "message cannot be empty" };
  }
  return { ok: true, content: parsedContent.data.content.trim(), replyToMessageId: parsedContent.data.replyToMessageId, attachments };
}

export async function loadMessageLimits(pool: pg.Pool): Promise<{ maxImageBytes: number; maxFileBytes: number; maxMessageLength: number }> {
  const settings = await pool.query<{ max_image_size_mb: number; max_file_size_mb: number; max_message_length: number }>(
    "SELECT max_image_size_mb, max_file_size_mb, max_message_length FROM server_settings WHERE singleton = true",
  );
  return {
    maxImageBytes: (settings.rows[0]?.max_image_size_mb ?? 5) * 1024 * 1024,
    maxFileBytes: (settings.rows[0]?.max_file_size_mb ?? 10) * 1024 * 1024,
    maxMessageLength: settings.rows[0]?.max_message_length ?? 4000,
  };
}

export function attachmentsWithinLimits(attachments: NewAttachment[], limits: { maxImageBytes: number; maxFileBytes: number }): boolean {
  return attachments.every((attachment) => {
    const isImage = attachment.mimeType.startsWith("image/");
    return attachment.content.length <= (isImage ? limits.maxImageBytes : limits.maxFileBytes);
  });
}
