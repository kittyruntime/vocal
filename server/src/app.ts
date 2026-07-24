import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import type pg from "pg";
import { registerAuthGuard } from "./auth/guard.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerInviteRoutes } from "./routes/invites.js";
import { registerChannelRoutes } from "./routes/channels.js";

export async function buildApp(opts: { pool: pg.Pool }): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    if (typeof err.statusCode === "number") {
      reply.code(err.statusCode).send({ error: err.message });
      return;
    }
    app.log.error(err);
    reply.code(500).send({ error: "internal server error" });
  });
  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: "not found" });
  });
  registerAuthGuard(app, opts.pool);
  app.get("/api/health", async () => ({ status: "ok" }));
  registerAuthRoutes(app, opts.pool);
  registerInviteRoutes(app, opts.pool);
  registerChannelRoutes(app, opts.pool);
  return app;
}
