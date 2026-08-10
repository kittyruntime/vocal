import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { WebhookReceiver } from "livekit-server-sdk";
import type { Capability } from "../capabilities.js";
import { mintVoiceToken, type LiveKitConfig } from "../voice/tokens.js";
import { channelRequiredCapability } from "../channels/lookup.js";
import type { WsHub } from "../ws/hub.js";
import type { VoicePresence } from "../voice/presence.js";

const idSchema = z.object({ id: z.uuid() });

export function registerVoiceTokenRoute(
  app: FastifyInstance, pool: pg.Pool, liveKitConfig: LiveKitConfig,
): void {
  app.post("/api/channels/:id/voice-token", { preHandler: app.requireAuth }, async (req, reply) => {
    const params = idSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid channel id" });
    const res = await pool.query<{ type: string; required_capability: Capability | null }>(
      "SELECT type, required_capability FROM channels WHERE id = $1", [params.data.id],
    );
    const channel = res.rows[0];
    if (!channel) return reply.code(404).send({ error: "channel not found" });
    if (channel.type !== "voice") return reply.code(400).send({ error: "not a voice channel" });
    if (channel.required_capability !== null && !req.user!.capabilities.includes(channel.required_capability)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const { token, url } = await mintVoiceToken(liveKitConfig, {
      channelId: params.data.id, userId: req.user!.id, username: req.user!.username,
      canPublish: req.user!.capabilities.includes("publish_voice"),
    });
    return reply.code(201).send({ token, url });
  });
}

export function registerVoiceWebhookRoute(
  app: FastifyInstance, pool: pg.Pool, hub: WsHub,
  liveKitConfig: LiveKitConfig, voicePresence: VoicePresence,
): void {
  const receiver = new WebhookReceiver(liveKitConfig.apiKey, liveKitConfig.apiSecret);

  // Scoped to this encapsulation context only: LiveKit's webhook signature is
  // computed over the exact raw request body, so this route needs the raw
  // string instead of Fastify's normal parsed-JSON body. Registering the
  // parser inside `app.register(async (instance) => ...)` keeps every other
  // route on the default JSON parser.
  app.register(async (instance) => {
    instance.addContentTypeParser(
      ["application/json", "application/webhook+json"],
      { parseAs: "string" },
      (_req, body, done) => {
        done(null, body);
      },
    );

    instance.post("/api/voice/webhook", async (req, reply) => {
      const rawBody = req.body as string;
      let event;
      try {
        event = await receiver.receive(rawBody, req.headers.authorization);
      } catch {
        return reply.code(401).send({ error: "invalid webhook signature" });
      }

      const channelId = event.room?.name;
      const userId = event.participant?.identity;
      if (channelId && userId && (event.event === "participant_joined" || event.event === "participant_left")) {
        const requiredCapability = await channelRequiredCapability(pool, channelId);
        if (requiredCapability !== undefined) {
          if (event.event === "participant_joined") {
            const participant = { userId, username: event.participant?.name || userId };
            voicePresence.join(channelId, participant);
            hub.broadcastToCapability(requiredCapability, { type: "voice.joined", channelId, participant });
          } else {
            voicePresence.leave(channelId, userId);
            hub.broadcastToCapability(requiredCapability, { type: "voice.left", channelId, userId });
          }
        }
      }
      return reply.code(200).send({ ok: true });
    });
  });
}
