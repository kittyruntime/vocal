import type pg from "pg";
import { encryptMessage, decryptMessage } from "../crypto/messages.js";
import type { MessageAttachmentPayload, MessagePayload } from "../ws/protocol.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

type Row = {
  id: string; channel_id: string; user_id: string;
  username: string; avatar_url: string | null; content_encrypted: string; created_at: Date;
};

export type NewAttachment = { filename: string; mimeType: string; content: Buffer };

function toPayload(row: Row, key: Buffer, attachments: MessageAttachmentPayload[] = []): MessagePayload {
  return {
    id: row.id,
    channelId: row.channel_id,
    userId: row.user_id,
    username: row.username,
    avatarUrl: row.avatar_url ? `/api/users/${row.user_id}/avatar` : null,
    content: decryptMessage(row.content_encrypted, key),
    createdAt: row.created_at.toISOString(),
    attachments,
  };
}

export async function createMessage(
  pool: pg.Pool, key: Buffer,
  input: { channelId: string; userId: string; content: string; attachments?: NewAttachment[] },
): Promise<MessagePayload> {
  const encrypted = encryptMessage(input.content, key);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query<Row>(
      `WITH inserted AS (
         INSERT INTO messages (channel_id, user_id, content_encrypted)
         VALUES ($1, $2, $3)
         RETURNING id, channel_id, user_id, content_encrypted, created_at
       )
       SELECT inserted.*, u.username, u.avatar_url FROM inserted
       JOIN users u ON u.id = inserted.user_id`,
      [input.channelId, input.userId, encrypted],
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
  input: { channelId: string; before?: string; limit?: number },
): Promise<MessagePayload[]> {
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const params: unknown[] = [input.channelId];
  let where = "m.channel_id = $1";
  if (input.before) {
    params.push(input.before);
    where += ` AND m.created_at < $${params.length}`;
  }
  params.push(limit);
  const res = await pool.query<Row>(
    `SELECT m.id, m.channel_id, m.user_id, u.username, u.avatar_url, m.content_encrypted, m.created_at
     FROM messages m JOIN users u ON u.id = m.user_id
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
  return res.rows.map((row) => toPayload(row, key, byMessage.get(row.id) ?? []));
}
