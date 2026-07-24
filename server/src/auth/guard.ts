import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { getSessionUser } from "./sessions.js";

export type SessionUser = { id: string; username: string; role: string };

declare module "fastify" {
  interface FastifyRequest { user?: SessionUser }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export function registerAuthGuard(app: FastifyInstance, pool: pg.Pool): void {
  app.decorate("requireAuth", async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.cookies.sid;
    const user = token ? await getSessionUser(pool, token) : null;
    if (!user) {
      await reply.code(401).send({ error: "authentication required" });
      return;
    }
    req.user = user;
  });
}
