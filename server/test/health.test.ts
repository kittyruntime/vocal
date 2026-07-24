import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type pg from "pg";
import { makeTestDb } from "./helpers/db.js";
import { buildApp } from "../src/app.js";

let pool: pg.Pool;
beforeAll(async () => { pool = await makeTestDb(); });
afterAll(async () => { await pool.end(); });

describe("health", () => {
  it("GET /api/health returns ok", async () => {
    const app = await buildApp({ pool });
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });
});
