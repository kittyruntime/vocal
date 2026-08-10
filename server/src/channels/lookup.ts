import type pg from "pg";
import type { Role } from "../roles.js";

// Returns the channel's min_role, or null if the channel doesn't exist.
export async function channelMinRole(pool: pg.Pool, channelId: string): Promise<Role | null> {
  const res = await pool.query<{ min_role: string }>(
    "SELECT min_role FROM channels WHERE id = $1", [channelId],
  );
  return (res.rows[0]?.min_role as Role | undefined) ?? null;
}
