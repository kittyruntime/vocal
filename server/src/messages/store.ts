import type pg from "pg";
import { encryptMessage, decryptMessage } from "../crypto/messages.js";
import type { MessagePayload } from "../ws/protocol.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

type Row = {
  id: string; channel_id: string; user_id: string;
  username: string; avatar_url: string | null; content_encrypted: string; created_at: Date;
};

function toPayload(row: Row, key: Buffer): MessagePayload {
  return {
    id: row.id,
    channelId: row.channel_id,
    userId: row.user_id,
    username: row.username,
    avatarUrl: row.avatar_url ? `/api/users/${row.user_id}/avatar` : null,
    content: decryptMessage(row.content_encrypted, key),
    createdAt: row.created_at.toISOString(),
  };
}

export async function createMessage(
  pool: pg.Pool, key: Buffer,
  input: { channelId: string; userId: string; content: string },
): Promise<MessagePayload> {
  const encrypted = encryptMessage(input.content, key);
  const res = await pool.query<Row>(
    `WITH inserted AS (
       INSERT INTO messages (channel_id, user_id, content_encrypted)
       VALUES ($1, $2, $3)
       RETURNING id, channel_id, user_id, content_encrypted, created_at
     )
     SELECT inserted.*, u.username, u.avatar_url FROM inserted
     JOIN users u ON u.id = inserted.user_id`,
    [input.channelId, input.userId, encrypted],
  );
  return toPayload(res.rows[0], key);
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
  return res.rows.map((row) => toPayload(row, key));
}
