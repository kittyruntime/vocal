import pg from "pg";
import { migrate } from "../../src/db/migrate.js";

process.env.MESSAGE_MASTER_KEY ??= Buffer.alloc(32, 7).toString("base64");

const ADMIN_URL = "postgres://vocal:vocal@localhost:5432/vocal";
export const TEST_URL = "postgres://vocal:vocal@localhost:5432/vocal_test";

export async function makeTestDb(): Promise<pg.Pool> {
  const admin = new pg.Pool({ connectionString: ADMIN_URL });
  await admin.query("DROP DATABASE IF EXISTS vocal_test WITH (FORCE)");
  await admin.query("CREATE DATABASE vocal_test");
  await admin.end();
  const pool = new pg.Pool({ connectionString: TEST_URL });
  await migrate(pool);
  return pool;
}
