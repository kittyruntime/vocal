import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { CAPABILITIES, type Capability } from "../capabilities.js";
import { requireCapability } from "../auth/guard.js";
import type { WsHub } from "../ws/hub.js";

const createSchema = z.object({
  name: z.string().min(1).max(64),
  type: z.enum(["text", "voice"]),
  requiredCapability: z.enum(CAPABILITIES).nullable().default(null),
  defaultAudioQuality: z.enum(["low", "standard", "high"]).default("standard"),
  defaultCameraQuality: z.enum(["low", "standard", "high"]).default("standard"),
  defaultScreenQuality: z.enum(["low", "standard", "high", "game"]).default("standard"),
});
const updateSchema = createSchema.omit({ type: true }).partial().refine((value) => Object.keys(value).length > 0);

const idSchema = z.object({ id: z.uuid() });

type ChannelRow = {
  id: string; name: string; type: string; required_capability: Capability | null;
  position: number; created_at: Date;
  default_audio_quality: string; default_camera_quality: string; default_screen_quality: string;
};

function toChannel(row: ChannelRow) {
  return {
    id: row.id, name: row.name, type: row.type, requiredCapability: row.required_capability,
    position: row.position, createdAt: row.created_at,
    defaultAudioQuality: row.default_audio_quality,
    defaultCameraQuality: row.default_camera_quality,
    defaultScreenQuality: row.default_screen_quality,
  };
}

export function registerChannelRoutes(app: FastifyInstance, pool: pg.Pool, hub: WsHub): void {
  app.post("/api/channels", { preHandler: [app.requireAuth, requireCapability("manage_channels")] }, async (req, reply) => {
    const body = createSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid payload" });
    const { name, type, requiredCapability, defaultAudioQuality, defaultCameraQuality, defaultScreenQuality } = body.data;
    const res = await pool.query<ChannelRow>(
      `INSERT INTO channels (name, type, required_capability, default_audio_quality, default_camera_quality, default_screen_quality)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, type, required_capability, position, created_at, default_audio_quality, default_camera_quality, default_screen_quality`,
      [name, type, requiredCapability, defaultAudioQuality, defaultCameraQuality, defaultScreenQuality],
    );
    const channel = toChannel(res.rows[0]);
    hub.broadcastToCapability(channel.requiredCapability, {
      type: "channel.created",
      channel: { ...channel, createdAt: channel.createdAt.toISOString() },
    });
    return reply.code(201).send(channel);
  });

  app.get("/api/channels", { preHandler: app.requireAuth }, async (req) => {
    const res = await pool.query<ChannelRow>(
      `SELECT id, name, type, required_capability, position, created_at, default_audio_quality, default_camera_quality, default_screen_quality
       FROM channels ORDER BY position, created_at`,
    );
    const capabilities = req.user!.capabilities;
    return res.rows
      .filter((row) => row.required_capability === null || capabilities.includes(row.required_capability))
      .map(toChannel);
  });

  app.patch("/api/channels/:id", { preHandler: [app.requireAuth, requireCapability("manage_channels")] }, async (req, reply) => {
    const params = idSchema.safeParse(req.params);
    const body = updateSchema.safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid payload" });
    const current = await pool.query<ChannelRow>("SELECT * FROM channels WHERE id = $1", [params.data.id]);
    if (!current.rowCount) return reply.code(404).send({ error: "channel not found" });
    const value = body.data;
    const result = await pool.query<ChannelRow>(
      `UPDATE channels SET name = $1, required_capability = $2, default_audio_quality = $3,
       default_camera_quality = $4, default_screen_quality = $5 WHERE id = $6
       RETURNING id, name, type, required_capability, position, created_at, default_audio_quality, default_camera_quality, default_screen_quality`,
      [value.name ?? current.rows[0].name,
        value.requiredCapability !== undefined ? value.requiredCapability : current.rows[0].required_capability,
        value.defaultAudioQuality ?? current.rows[0].default_audio_quality,
        value.defaultCameraQuality ?? current.rows[0].default_camera_quality,
        value.defaultScreenQuality ?? current.rows[0].default_screen_quality, params.data.id],
    );
    const channel = toChannel(result.rows[0]);
    // Removing first also evicts the channel from clients that just lost access;
    // eligible clients immediately receive the updated representation.
    hub.broadcast({ type: "channel.deleted", channelId: params.data.id });
    hub.broadcastToCapability(channel.requiredCapability, {
      type: "channel.created",
      channel: { ...channel, createdAt: channel.createdAt.toISOString() },
    });
    return channel;
  });

  app.delete("/api/channels/:id", { preHandler: [app.requireAuth, requireCapability("manage_channels")] }, async (req, reply) => {
    const params = idSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid channel id" });
    const res = await pool.query<{ required_capability: Capability | null }>(
      "DELETE FROM channels WHERE id = $1 RETURNING required_capability", [params.data.id],
    );
    if ((res.rowCount ?? 0) > 0) {
      hub.broadcastToCapability(res.rows[0].required_capability, {
        type: "channel.deleted", channelId: params.data.id,
      });
    }
    return reply.code(204).send();
  });
}
