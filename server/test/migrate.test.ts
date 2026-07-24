import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type pg from "pg";
import { makeTestDb } from "./helpers/db.js";
import { migrate } from "../src/db/migrate.js";

let pool: pg.Pool;
beforeAll(async () => { pool = await makeTestDb(); });
afterAll(async () => { await pool.end(); });

describe("migrations", () => {
  it("creates users, sessions and invites tables", async () => {
    const res = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const names = res.rows.map((r) => r.table_name);
    expect(names).toContain("users");
    expect(names).toContain("sessions");
    expect(names).toContain("invites");
    expect(names).toContain("schema_migrations");
  });

  it("is idempotent", async () => {
    await migrate(pool); // seconde exécution : ne doit pas jeter
  });
});
