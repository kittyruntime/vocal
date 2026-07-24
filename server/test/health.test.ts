import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import { makeTestDb } from "./helpers/db.js";
import { buildApp } from "../src/app.js";

let pool: pg.Pool;
beforeAll(async () => { pool = await makeTestDb(); });
afterAll(async () => { await pool.end(); });

describe("health", () => {
  it("GET /api/health returns ok", async () => {
    let app: FastifyInstance;
    ({ app } = await buildApp({ pool }));
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("unknown routes return the { error } shape with 404", async () => {
    let app: FastifyInstance;
    ({ app } = await buildApp({ pool }));
    const res = await app.inject({ method: "GET", url: "/api/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not found" });
    await app.close();
  });
});
