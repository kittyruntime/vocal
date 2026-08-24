import type pg from "pg";
import type { ConversationPayload, ConversationParticipantPayload } from "../ws/protocol.js";

type ConversationRow = { id: string; type: "dm" | "group"; name: string | null; created_at: Date };
type ParticipantRow = { conversation_id: string; user_id: string; username: string; avatar_url: string | null };

async function participantsByConversation(pool: pg.Pool, conversationIds: string[]): Promise<Map<string, ConversationParticipantPayload[]>> {
  const res = await pool.query<ParticipantRow>(
    `SELECT cp.conversation_id, cp.user_id, u.username, u.avatar_url
     FROM conversation_participants cp JOIN users u ON u.id = cp.user_id
     WHERE cp.conversation_id = ANY($1::uuid[]) ORDER BY u.username`,
    [conversationIds],
  );
  const byConversation = new Map<string, ConversationParticipantPayload[]>();
  for (const row of res.rows) {
    const values = byConversation.get(row.conversation_id) ?? [];
    values.push({ userId: row.user_id, username: row.username, avatarUrl: row.avatar_url ? `/api/users/${row.user_id}/avatar` : null });
    byConversation.set(row.conversation_id, values);
  }
  return byConversation;
}

function toPayload(row: ConversationRow, participants: ConversationParticipantPayload[]): ConversationPayload {
  return { id: row.id, type: row.type, name: row.name, participants, createdAt: row.created_at.toISOString() };
}

export async function getConversation(pool: pg.Pool, conversationId: string): Promise<ConversationPayload | null> {
  const res = await pool.query<ConversationRow>("SELECT id, type, name, created_at FROM conversations WHERE id = $1", [conversationId]);
  if (!res.rows[0]) return null;
  const participants = (await participantsByConversation(pool, [conversationId])).get(conversationId) ?? [];
  return toPayload(res.rows[0], participants);
}

export async function isParticipant(pool: pg.Pool, conversationId: string, userId: string): Promise<boolean> {
  const res = await pool.query("SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2", [conversationId, userId]);
  return (res.rowCount ?? 0) > 0;
}

export async function participantUserIds(pool: pg.Pool, conversationId: string): Promise<string[]> {
  const res = await pool.query<{ user_id: string }>("SELECT user_id FROM conversation_participants WHERE conversation_id = $1", [conversationId]);
  return res.rows.map((row) => row.user_id);
}

export async function listConversationsForUser(pool: pg.Pool, userId: string): Promise<ConversationPayload[]> {
  const res = await pool.query<ConversationRow>(
    `SELECT c.id, c.type, c.name, c.created_at FROM conversations c
     JOIN conversation_participants cp ON cp.conversation_id = c.id
     WHERE cp.user_id = $1
     ORDER BY c.created_at DESC`,
    [userId],
  );
  if (res.rows.length === 0) return [];
  const byConversation = await participantsByConversation(pool, res.rows.map((row) => row.id));
  return res.rows.map((row) => toPayload(row, byConversation.get(row.id) ?? []));
}

// Returns the existing 1:1 conversation between the two users if one already
// exists (Discord-style DM reuse), so repeated "message this user" actions
// don't spawn duplicate conversations.
async function findExistingDirectMessage(pool: pg.Pool, userA: string, userB: string): Promise<string | null> {
  const res = await pool.query<{ conversation_id: string }>(
    `SELECT cp1.conversation_id FROM conversation_participants cp1
     JOIN conversation_participants cp2 ON cp2.conversation_id = cp1.conversation_id
     JOIN conversations c ON c.id = cp1.conversation_id
     WHERE c.type = 'dm' AND cp1.user_id = $1 AND cp2.user_id = $2`,
    [userA, userB],
  );
  return res.rows[0]?.conversation_id ?? null;
}

export async function createDirectMessage(pool: pg.Pool, creatorId: string, otherUserId: string): Promise<ConversationPayload | null> {
  if (creatorId === otherUserId) return null;
  const existing = await findExistingDirectMessage(pool, creatorId, otherUserId);
  if (existing) return getConversation(pool, existing);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<ConversationRow>(
      "INSERT INTO conversations (type, name, created_by) VALUES ('dm', NULL, $1) RETURNING id, type, name, created_at",
      [creatorId],
    );
    const conversationId = inserted.rows[0].id;
    await client.query(
      "INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1, $2), ($1, $3)",
      [conversationId, creatorId, otherUserId],
    );
    await client.query("COMMIT");
    return getConversation(pool, conversationId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createGroup(pool: pg.Pool, creatorId: string, participantIds: string[], name: string | null): Promise<ConversationPayload> {
  const uniqueOthers = [...new Set(participantIds.filter((id) => id !== creatorId))];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<ConversationRow>(
      "INSERT INTO conversations (type, name, created_by) VALUES ('group', $1, $2) RETURNING id, type, name, created_at",
      [name, creatorId],
    );
    const conversationId = inserted.rows[0].id;
    const values = [creatorId, ...uniqueOthers];
    const placeholders = values.map((_, i) => `($1, $${i + 2})`).join(", ");
    await client.query(`INSERT INTO conversation_participants (conversation_id, user_id) VALUES ${placeholders}`, [conversationId, ...values]);
    await client.query("COMMIT");
    return (await getConversation(pool, conversationId))!;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function renameConversation(pool: pg.Pool, conversationId: string, name: string): Promise<ConversationPayload | null> {
  const updated = await pool.query("UPDATE conversations SET name = $1 WHERE id = $2 AND type = 'group'", [name, conversationId]);
  return updated.rowCount ? getConversation(pool, conversationId) : null;
}

export async function addParticipant(pool: pg.Pool, conversationId: string, userId: string): Promise<ConversationPayload | null> {
  const inserted = await pool.query(
    `INSERT INTO conversation_participants (conversation_id, user_id)
     SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM conversations WHERE id = $1 AND type = 'group')
     ON CONFLICT DO NOTHING`,
    [conversationId, userId],
  );
  if (inserted.rowCount === 0) {
    const exists = await isParticipant(pool, conversationId, userId);
    if (!exists) return null;
  }
  return getConversation(pool, conversationId);
}

// Removing the last participant deletes the now-empty conversation (and its
// messages, via ON DELETE CASCADE) rather than leaving an orphaned row.
export async function removeParticipant(pool: pg.Pool, conversationId: string, userId: string): Promise<void> {
  await pool.query(
    "DELETE FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2 AND (SELECT type FROM conversations WHERE id = $1) = 'group'",
    [conversationId, userId],
  );
  const remaining = await pool.query("SELECT 1 FROM conversation_participants WHERE conversation_id = $1", [conversationId]);
  if (remaining.rowCount === 0) await pool.query("DELETE FROM conversations WHERE id = $1", [conversationId]);
}
