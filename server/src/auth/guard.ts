import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { getSessionUser } from "./sessions.js";
import type { Capability } from "../capabilities.js";

export type SessionUser = {
  id: string;
  username: string;
  email: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  description: string;
  capabilities: Capability[];
  voiceMuted: boolean;
};

declare module "fastify" {
  interface FastifyRequest { user?: SessionUser }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

// The cookie is the default transport for browser clients (same-origin,
// httpOnly). Non-browser/cross-origin clients -- namely the desktop app,
// which can point at an arbitrary self-hosted server and can't rely on
// SameSite cookies working across origins -- authenticate with the same
// session token via a Bearer header instead.
export function extractSessionToken(req: FastifyRequest): string | undefined {
  if (req.cookies.sid) return req.cookies.sid;
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length);
  return undefined;
}

export function registerAuthGuard(app: FastifyInstance, pool: pg.Pool): void {
  app.decorate("requireAuth", async (req: FastifyRequest, reply: FastifyReply) => {
    const token = extractSessionToken(req);
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
