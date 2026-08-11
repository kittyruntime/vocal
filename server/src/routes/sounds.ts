import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { requireCapability } from "../auth/guard.js";

export const SOUND_EVENTS = ["message", "userJoin", "userLeave", "muteToggle", "forceMuted"] as const;
export type SoundEvent = (typeof SOUND_EVENTS)[number];

const DEFAULT_VOLUME = 55;

const eventParamSchema = z.object({ event: z.enum(SOUND_EVENTS) });
const patchSoundSchema = z.object({
  enabled: z.boolean().optional(),
  audioData: z.union([
    z.string().max(7_000_000).regex(/^data:audio\/(?:mpeg|ogg|wav|webm);base64,[A-Za-z0-9+/]+=*$/),
    z.null(),
  ]).optional(),
});
const patchVolumeSchema = z.object({
  event: z.enum(SOUND_EVENTS),
  volume: z.number().int().min(0).max(100),
});

type ServerSoundRow = { event: SoundEvent; enabled: boolean; audio_data: string | null };

function fillVolumes(stored: Record<string, number>): Record<SoundEvent, number> {
  return Object.fromEntries(SOUND_EVENTS.map((event) => [event, stored[event] ?? DEFAULT_VOLUME])) as Record<SoundEvent, number>;
}

export function registerSoundRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.get("/api/sounds", { preHandler: app.requireAuth }, async () => {
    const result = await pool.query<ServerSoundRow>("SELECT event, enabled, audio_data FROM server_sounds");
    const byEvent = new Map(result.rows.map((row) => [row.event, row]));
    return Object.fromEntries(SOUND_EVENTS.map((event) => {
      const row = byEvent.get(event);
      return [event, { enabled: row?.enabled ?? true, hasCustom: Boolean(row?.audio_data) }];
    }));
  });

  app.get("/api/sounds/:event/file", { preHandler: app.requireAuth }, async (req, reply) => {
    const params = eventParamSchema.safeParse(req.params);
    if (!params.success) return reply.code(404).send({ error: "sound not found" });
    const result = await pool.query<{ audio_data: string | null }>(
      "SELECT audio_data FROM server_sounds WHERE event = $1",
      [params.data.event],
    );
    const encoded = result.rows[0]?.audio_data;
    const match = encoded?.match(/^data:(audio\/(?:mpeg|ogg|wav|webm));base64,(.+)$/);
    if (!match) return reply.code(404).send({ error: "sound not found" });
    const etag = `"${createHash("sha256").update(match[2]).digest("hex")}"`;
    if (req.headers["if-none-match"] === etag) return reply.code(304).send();
    return reply
      .type(match[1])
      .header("Cache-Control", "private, no-cache")
      .header("ETag", etag)
      .send(Buffer.from(match[2], "base64"));
  });

  app.patch("/api/admin/sounds/:event", { preHandler: [app.requireAuth, requireCapability("manage_server")], bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const params = eventParamSchema.safeParse(req.params);
    const body = patchSoundSchema.safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid payload" });
    const setsAudioData = "audioData" in body.data;
    const result = await pool.query<{ enabled: boolean; audio_data: string | null }>(
      `UPDATE server_sounds SET
         enabled = COALESCE($1, enabled),
         audio_data = CASE WHEN $3 THEN $2 ELSE audio_data END
       WHERE event = $4 RETURNING enabled, audio_data`,
      [body.data.enabled ?? null, body.data.audioData ?? null, setsAudioData, params.data.event],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "sound not found" });
    return { enabled: result.rows[0].enabled, hasCustom: Boolean(result.rows[0].audio_data) };
  });

  app.get("/api/me/sound-volumes", { preHandler: app.requireAuth }, async (req) => {
    const result = await pool.query<{ sound_volumes: Record<string, number> }>(
      "SELECT sound_volumes FROM users WHERE id = $1",
      [req.user!.id],
    );
    return fillVolumes(result.rows[0]?.sound_volumes ?? {});
  });

  app.patch("/api/me/sound-volumes", { preHandler: app.requireAuth }, async (req, reply) => {
    const body = patchVolumeSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid payload" });
    const result = await pool.query<{ sound_volumes: Record<string, number> }>(
      `UPDATE users SET sound_volumes = jsonb_set(sound_volumes, ARRAY[$1::text], to_jsonb($2::int), true)
       WHERE id = $3 RETURNING sound_volumes`,
      [body.data.event, body.data.volume, req.user!.id],
    );
    return fillVolumes(result.rows[0]?.sound_volumes ?? {});
  });
}
