import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import type pg from "pg";
import { registerAuthGuard } from "./auth/guard.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerInviteRoutes } from "./routes/invites.js";
import { registerChannelRoutes } from "./routes/channels.js";
import { createHub, type WsHub } from "./ws/hub.js";
import { registerWsRoute } from "./ws/route.js";
import { loadMasterKey } from "./crypto/messages.js";
import { registerMessageRoutes } from "./routes/messages.js";
import { loadLiveKitConfig } from "./voice/tokens.js";
import { registerVoiceTokenRoute, registerVoiceWebhookRoute } from "./routes/voice.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { createVoicePresence, type VoicePresence } from "./voice/presence.js";
import { createVoiceAdminService, type VoiceAdminService } from "./voice/admin.js";

export async function buildApp(
  opts: { pool: pg.Pool; voiceAdmin?: VoiceAdminService },
): Promise<{ app: FastifyInstance; hub: WsHub; voicePresence: VoicePresence }> {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(websocket);
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024, files: 10, fields: 5 },
  });
  const hub = createHub();
  const key = loadMasterKey();
  const liveKitConfig = loadLiveKitConfig();
  const voicePresence = createVoicePresence();
  const voiceAdmin = opts.voiceAdmin ?? createVoiceAdminService(liveKitConfig);
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
  registerAdminRoutes(app, opts.pool, hub, voicePresence, voiceAdmin);
  registerInviteRoutes(app, opts.pool);
  registerChannelRoutes(app, opts.pool, hub);
  registerMessageRoutes(app, opts.pool, key, hub);
  registerVoiceTokenRoute(app, opts.pool, liveKitConfig);
  registerVoiceWebhookRoute(app, opts.pool, hub, liveKitConfig, voicePresence);
  registerWsRoute(app, opts.pool, hub, voicePresence);
  return { app, hub, voicePresence };
}
