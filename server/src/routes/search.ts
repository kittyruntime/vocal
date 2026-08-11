import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { decryptMessage } from "../crypto/messages.js";

const querySchema = z.object({ q: z.string().trim().min(2).max(100) });

export function registerSearchRoutes(app: FastifyInstance, pool: pg.Pool, key: Buffer): void {
  app.get("/api/search", { preHandler: app.requireAuth }, async (req, reply) => {
    const query = querySchema.safeParse(req.query); if (!query.success) return reply.code(400).send({ error: "invalid search" });
    const needle = query.data.q.toLocaleLowerCase();
    const capabilities = req.user!.capabilities;
    const [channels, members, candidates] = await Promise.all([
      pool.query(`SELECT id, name, type FROM channels WHERE (required_capability IS NULL OR required_capability = ANY($1::text[])) AND name ILIKE $2 ORDER BY position LIMIT 10`, [capabilities, `%${query.data.q}%`]),
      pool.query(`SELECT id, username, avatar_url FROM users WHERE banned_at IS NULL AND username ILIKE $1 ORDER BY username LIMIT 10`, [`%${query.data.q}%`]),
      pool.query<{ id: string; channel_id: string; channel_name: string; username: string; content_encrypted: string; created_at: Date; filenames: string[] }>(
        `SELECT m.id, m.channel_id, c.name AS channel_name, u.username, m.content_encrypted, m.created_at,
          ARRAY(SELECT filename FROM message_attachments WHERE message_id = m.id) AS filenames
         FROM messages m JOIN channels c ON c.id = m.channel_id JOIN users u ON u.id = m.user_id
         WHERE c.required_capability IS NULL OR c.required_capability = ANY($1::text[])
         ORDER BY m.created_at DESC LIMIT 500`, [capabilities],
      ),
    ]);
    const messages = candidates.rows.flatMap((row) => {
      const content = decryptMessage(row.content_encrypted, key);
      if (!content.toLocaleLowerCase().includes(needle) && !row.filenames.some((filename) => filename.toLocaleLowerCase().includes(needle))) return [];
      return [{ id: row.id, channelId: row.channel_id, channelName: row.channel_name, username: row.username, content, filenames: row.filenames, createdAt: row.created_at.toISOString() }];
    }).slice(0, 30);
    return {
      channels: channels.rows,
      members: members.rows.map((member) => ({ id: member.id, username: member.username, avatarUrl: member.avatar_url ? `/api/users/${member.id}/avatar` : null })),
      messages,
    };
  });
}
