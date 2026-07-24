import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app.js";

describe("health", () => {
  it("GET /api/health returns ok", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });
});
