import type pg from "pg";
import { encryptMessage, decryptMessage } from "../crypto/messages.js";
import type { MessageAttachmentPayload, MessagePayload, MessageReactionPayload } from "../ws/protocol.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

type Row = {
  id: string; channel_id: string | null; conversation_id: string | null; user_id: string;
  username: string; avatar_url: string | null; content_encrypted: string; created_at: Date; edited_at: Date | null;
  reply_id: string | null; reply_user_id: string | null; reply_username: string | null; reply_content_encrypted: string | null;
};

export type NewAttachment = { filename: string; mimeType: string; content: Buffer };

// Exactly one of channelId/conversationId identifies where a message lives.
export type MessageTarget = { channelId: string; conversationId?: undefined } | { channelId?: undefined; conversationId: string };

function toPayload(row: Row, key: Buffer, attachments: MessageAttachmentPayload[] = [], reactions: MessageReactionPayload[] = []): MessagePayload {
  return {
    id: row.id,
    channelId: row.channel_id ?? undefined,
    conversationId: row.conversation_id ?? undefined,
    userId: row.user_id,
    username: row.username,
    avatarUrl: row.avatar_url ? `/api/users/${row.user_id}/avatar` : null,
    content: decryptMessage(row.content_encrypted, key),
    createdAt: row.created_at.toISOString(),
    editedAt: row.edited_at?.toISOString() ?? null,
    replyTo: row.reply_id && row.reply_user_id && row.reply_username && row.reply_content_encrypted ? {
      id: row.reply_id,
      userId: row.reply_user_id,
      username: row.reply_username,
      content: decryptMessage(row.reply_content_encrypted, key),
    } : null,
    reactions,
    attachments,
  };
}

export async function createMessage(
  pool: pg.Pool, key: Buffer,
  input: MessageTarget & { userId: string; content: string; attachments?: NewAttachment[]; replyToMessageId?: string },
): Promise<MessagePayload> {
  const encrypted = encryptMessage(input.content, key);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query<Row>(
      `WITH inserted AS (
         INSERT INTO messages (channel_id, conversation_id, user_id, content_encrypted, reply_to_message_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, channel_id, conversation_id, user_id, content_encrypted, created_at, edited_at, reply_to_message_id
       )
       SELECT inserted.id, inserted.channel_id, inserted.conversation_id, inserted.user_id, inserted.content_encrypted, inserted.created_at,
              inserted.edited_at, u.username, u.avatar_url,
              r.id AS reply_id, r.user_id AS reply_user_id, ru.username AS reply_username,
              r.content_encrypted AS reply_content_encrypted
       FROM inserted JOIN users u ON u.id = inserted.user_id
       LEFT JOIN messages r ON r.id = inserted.reply_to_message_id
       LEFT JOIN users ru ON ru.id = r.user_id`,
      [input.channelId ?? null, input.conversationId ?? null, input.userId, encrypted, input.replyToMessageId ?? null],
    );
    const attachments: MessageAttachmentPayload[] = [];
    for (const attachment of input.attachments ?? []) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO message_attachments (message_id, filename, mime_type, byte_size, content)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [res.rows[0].id, attachment.filename, attachment.mimeType, attachment.content.length, attachment.content],
      );
      const id = inserted.rows[0].id;
      attachments.push({ id, filename: attachment.filename, mimeType: attachment.mimeType, size: attachment.content.length, url: `/api/attachments/${id}` });
    }
    await client.query("COMMIT");
    return toPayload(res.rows[0], key, attachments);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listMessages(
  pool: pg.Pool, key: Buffer,
  input: MessageTarget & { before?: string; limit?: number },
): Promise<MessagePayload[]> {
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const params: unknown[] = [input.channelId ?? input.conversationId];
  let where = input.conversationId ? "m.conversation_id = $1" : "m.channel_id = $1";
  if (input.before) {
    params.push(input.before);
    where += ` AND m.created_at < $${params.length}`;
  }
  params.push(limit);
  const res = await pool.query<Row>(
    `SELECT m.id, m.channel_id, m.conversation_id, m.user_id, u.username, u.avatar_url, m.content_encrypted, m.created_at, m.edited_at,
            r.id AS reply_id, r.user_id AS reply_user_id, ru.username AS reply_username, r.content_encrypted AS reply_content_encrypted
     FROM messages m JOIN users u ON u.id = m.user_id
     LEFT JOIN messages r ON r.id = m.reply_to_message_id
     LEFT JOIN users ru ON ru.id = r.user_id
     WHERE ${where}
     ORDER BY m.created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  if (res.rows.length === 0) return [];
  const attachmentRows = await pool.query<{
    id: string; message_id: string; filename: string; mime_type: string; byte_size: number;
  }>(
    `SELECT id, message_id, filename, mime_type, byte_size
     FROM message_attachments WHERE message_id = ANY($1::uuid[]) ORDER BY created_at`,
    [res.rows.map((row) => row.id)],
  );
  const byMessage = new Map<string, MessageAttachmentPayload[]>();
  for (const attachment of attachmentRows.rows) {
    const values = byMessage.get(attachment.message_id) ?? [];
    values.push({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mime_type,
      size: attachment.byte_size,
      url: `/api/attachments/${attachment.id}`,
    });
    byMessage.set(attachment.message_id, values);
  }
  const reactionRows = await pool.query<{ message_id: string; emoji: string; user_ids: string[] }>(
    `SELECT message_id, emoji, array_agg(user_id::text ORDER BY created_at) AS user_ids
     FROM message_reactions WHERE message_id = ANY($1::uuid[]) GROUP BY message_id, emoji ORDER BY emoji`,
    [res.rows.map((row) => row.id)],
  );
  const reactionsByMessage = new Map<string, MessageReactionPayload[]>();
  for (const reaction of reactionRows.rows) {
    const values = reactionsByMessage.get(reaction.message_id) ?? [];
    values.push({ emoji: reaction.emoji, count: reaction.user_ids.length, userIds: reaction.user_ids });
    reactionsByMessage.set(reaction.message_id, values);
  }
  return res.rows.map((row) => toPayload(row, key, byMessage.get(row.id) ?? [], reactionsByMessage.get(row.id) ?? []));
}

export async function getMessage(pool: pg.Pool, key: Buffer, messageId: string): Promise<MessagePayload | null> {
  const row = await pool.query<Row>(
    `SELECT m.id, m.channel_id, m.conversation_id, m.user_id, u.username, u.avatar_url, m.content_encrypted, m.created_at, m.edited_at,
            r.id AS reply_id, r.user_id AS reply_user_id, ru.username AS reply_username, r.content_encrypted AS reply_content_encrypted
     FROM messages m JOIN users u ON u.id = m.user_id
     LEFT JOIN messages r ON r.id = m.reply_to_message_id LEFT JOIN users ru ON ru.id = r.user_id WHERE m.id = $1`,
    [messageId],
  );
  if (!row.rows[0]) return null;
  const [attachments, reactions] = await Promise.all([
    pool.query<{ id: string; filename: string; mime_type: string; byte_size: number }>("SELECT id, filename, mime_type, byte_size FROM message_attachments WHERE message_id = $1 ORDER BY created_at", [messageId]),
    pool.query<{ emoji: string; user_ids: string[] }>("SELECT emoji, array_agg(user_id::text ORDER BY created_at) AS user_ids FROM message_reactions WHERE message_id = $1 GROUP BY emoji ORDER BY emoji", [messageId]),
  ]);
  return toPayload(row.rows[0], key, attachments.rows.map((value) => ({ id: value.id, filename: value.filename, mimeType: value.mime_type, size: value.byte_size, url: `/api/attachments/${value.id}` })), reactions.rows.map((value) => ({ emoji: value.emoji, count: value.user_ids.length, userIds: value.user_ids })));
}

export async function updateMessageContent(pool: pg.Pool, key: Buffer, messageId: string, content: string): Promise<MessagePayload | null> {
  const encrypted = encryptMessage(content, key);
  const updated = await pool.query("UPDATE messages SET content_encrypted = $1, edited_at = now() WHERE id = $2 RETURNING id", [encrypted, messageId]);
  return updated.rowCount ? getMessage(pool, key, messageId) : null;
}

export async function setMessageReaction(pool: pg.Pool, key: Buffer, messageId: string, userId: string, emoji: string, active: boolean): Promise<MessagePayload | null> {
  if (active) await pool.query("INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [messageId, userId, emoji]);
  else await pool.query("DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3", [messageId, userId, emoji]);
  return getMessage(pool, key, messageId);
}
