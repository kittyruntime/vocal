import type pg from "pg";
import type { Capability } from "../capabilities.js";

// Returns the channel's required capability (null = open to any authenticated
// user), or undefined if the channel doesn't exist.
export async function channelRequiredCapability(
  pool: pg.Pool, channelId: string,
): Promise<Capability | null | undefined> {
  const res = await pool.query<{ required_capability: Capability | null }>(
    "SELECT required_capability FROM channels WHERE id = $1", [channelId],
  );
  if (res.rowCount === 0) return undefined;
  return res.rows[0].required_capability;
}
