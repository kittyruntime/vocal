import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import type { SessionUser } from "./guard.js";

const SESSION_DAYS = 30;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  pool: pg.Pool, userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  await pool.query(
    "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    [userId, hashToken(token), expiresAt],
  );
  return { token, expiresAt };
}

export async function getSessionUser(
  pool: pg.Pool, token: string,
): Promise<SessionUser | null> {
  const res = await pool.query(
    `SELECT u.id, u.username, u.email, u.avatar_url AS "avatarUrl", u.banner_url AS "bannerUrl", u.description,
       u.voice_muted AS "voiceMuted",
       COALESCE(array_agg(uc.capability) FILTER (WHERE uc.capability IS NOT NULL), '{}') AS capabilities
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN user_capabilities uc ON uc.user_id = u.id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.banned_at IS NULL
     GROUP BY u.id, u.username, u.email, u.avatar_url, u.banner_url, u.description`,
    [hashToken(token)],
  );
  // role is DB-constrained to the admin/moderator/member CHECK, so this
  // narrowing cast at the read boundary is safe.
  return (res.rows[0] as SessionUser | undefined) ?? null;
}

export async function deleteSession(pool: pg.Pool, token: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
}
