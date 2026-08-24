import pg from "pg";
import { migrate } from "../../src/db/migrate.js";

process.env.MESSAGE_MASTER_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.LIVEKIT_URL ??= "ws://localhost:7880";
process.env.LIVEKIT_API_KEY ??= "devkey";
process.env.LIVEKIT_API_SECRET ??= "secret";

const ADMIN_URL = "postgres://vocal:vocal@localhost:5433/vocal";
export const TEST_URL = "postgres://vocal:vocal@localhost:5433/vocal_test";

export async function makeTestDb(): Promise<pg.Pool> {
  const admin = new pg.Pool({ connectionString: ADMIN_URL });
  await admin.query("DROP DATABASE IF EXISTS vocal_test WITH (FORCE)");
  await admin.query("CREATE DATABASE vocal_test");
  await admin.end();
  const pool = new pg.Pool({ connectionString: TEST_URL });
  await migrate(pool);
  return pool;
}
