import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { getSessionUser } from "./sessions.js";
import type { Capability } from "../capabilities.js";

export type SessionUser = { id: string; username: string; capabilities: Capability[]; voiceMuted: boolean };

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

export function requireCapability(capability: Capability) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!req.user?.capabilities.includes(capability)) {
      await reply.code(403).send({ error: "forbidden" });
    }
  };
}

export function requireAnyCapability(...capabilities: Capability[]) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!capabilities.some((capability) => req.user?.capabilities.includes(capability))) {
      await reply.code(403).send({ error: "forbidden" });
    }
  };
}
