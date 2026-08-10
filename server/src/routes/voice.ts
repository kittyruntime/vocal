import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { hasAtLeastRole, type Role } from "../roles.js";
import { mintVoiceToken, type LiveKitConfig } from "../voice/tokens.js";

const idSchema = z.object({ id: z.uuid() });

export function registerVoiceTokenRoute(
  app: FastifyInstance, pool: pg.Pool, liveKitConfig: LiveKitConfig,
): void {
  app.post("/api/channels/:id/voice-token", { preHandler: app.requireAuth }, async (req, reply) => {
    const params = idSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid channel id" });
    const res = await pool.query<{ type: string; min_role: string }>(
      "SELECT type, min_role FROM channels WHERE id = $1", [params.data.id],
    );
    const channel = res.rows[0];
    if (!channel) return reply.code(404).send({ error: "channel not found" });
    if (channel.type !== "voice") return reply.code(400).send({ error: "not a voice channel" });
    if (!hasAtLeastRole(req.user!.role as Role, channel.min_role as Role)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const { token, url } = await mintVoiceToken(liveKitConfig, {
      channelId: params.data.id, userId: req.user!.id, username: req.user!.username,
    });
    return reply.code(201).send({ token, url });
  });
}
