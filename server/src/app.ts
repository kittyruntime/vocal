import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import type pg from "pg";
import { registerAuthGuard } from "./auth/guard.js";
import { registerAuthRoutes } from "./routes/auth.js";

export async function buildApp(opts: { pool: pg.Pool }): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  registerAuthGuard(app, opts.pool);
  app.get("/api/health", async () => ({ status: "ok" }));
  registerAuthRoutes(app, opts.pool);
  return app;
}
