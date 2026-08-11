import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import type { WsHub } from "../ws/hub.js";
import { CAPABILITIES, type Capability } from "../capabilities.js";
import { requireAnyCapability, requireCapability } from "../auth/guard.js";
import type { VoicePresence } from "../voice/presence.js";
import type { VoiceAdminService } from "../voice/admin.js";

const capabilitiesSchema = z.object({ capabilities: z.array(z.enum(CAPABILITIES)) });
const idSchema = z.object({ id: z.uuid() });
const listUsersQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const settingsSchema = z.object({
  registrationOpen: z.boolean().optional(),
  maxImageSizeMb: z.number().int().min(1).max(50).optional(),
  maxFileSizeMb: z.number().int().min(1).max(50).optional(),
  maxMessageLength: z.number().int().min(100).max(10000).optional(),
});

type SettingsRow = { registration_open: boolean; max_image_size_mb: number; max_file_size_mb: number; max_message_length: number };
function toSettings(row: SettingsRow | undefined) {
  return {
    registrationOpen: row?.registration_open ?? true,
    maxImageSizeMb: row?.max_image_size_mb ?? 5,
    maxFileSizeMb: row?.max_file_size_mb ?? 10,
    maxMessageLength: row?.max_message_length ?? 4000,
  };
}

type AdminUserRow = { id: string; username: string; avatar_url: string | null; created_at: Date; banned_at: Date | null; voice_muted: boolean; capabilities: Capability[]; roles: { id: string; name: string; color: string }[] };

const adminUserSelect = `SELECT u.id, u.username, u.avatar_url, u.created_at, u.banned_at, u.voice_muted,
  ARRAY(SELECT capability FROM user_capabilities WHERE user_id = u.id
        UNION SELECT rc.capability FROM user_roles ur JOIN role_capabilities rc ON rc.role_id = ur.role_id WHERE ur.user_id = u.id) AS capabilities,
  COALESCE((SELECT json_agg(json_build_object('id', r.id, 'name', r.name, 'color', r.color) ORDER BY r.position DESC)
            FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '[]') AS roles
  FROM users u`;

async function fetchAdminUser(pool: pg.Pool, userId: string): Promise<AdminUserRow | null> {
  const result = await pool.query<AdminUserRow>(
    `${adminUserSelect} WHERE u.id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

function toAdminUser(row: AdminUserRow) {
  return { id: row.id, username: row.username, avatarUrl: row.avatar_url ? `/api/users/${row.id}/avatar` : null, capabilities: row.capabilities, roles: row.roles, createdAt: row.created_at, bannedAt: row.banned_at, voiceMuted: row.voice_muted };
}

export function registerAdminRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  hub: WsHub,
  voicePresence: VoicePresence,
  voiceAdmin: VoiceAdminService,
): void {
  app.get("/api/registration-status", async () => {
    const result = await pool.query<{ registration_open: boolean }>("SELECT registration_open FROM server_settings WHERE singleton = true");
    return { registrationOpen: result.rows[0]?.registration_open ?? true };
  });

  app.get("/api/admin/settings", { preHandler: [app.requireAuth, requireCapability("manage_server")] }, async () => {
    const result = await pool.query<SettingsRow>("SELECT registration_open, max_image_size_mb, max_file_size_mb, max_message_length FROM server_settings WHERE singleton = true");
    return toSettings(result.rows[0]);
  });

  app.patch("/api/admin/settings", { preHandler: [app.requireAuth, requireCapability("manage_server")] }, async (req, reply) => {
    const body = settingsSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid payload" });
    const result = await pool.query<SettingsRow>(
      `UPDATE server_settings SET
         registration_open = COALESCE($1, registration_open),
         max_image_size_mb = COALESCE($2, max_image_size_mb),
         max_file_size_mb = COALESCE($3, max_file_size_mb),
         max_message_length = COALESCE($4, max_message_length)
       WHERE singleton = true RETURNING registration_open, max_image_size_mb, max_file_size_mb, max_message_length`,
      [body.data.registrationOpen, body.data.maxImageSizeMb, body.data.maxFileSizeMb, body.data.maxMessageLength],
    );
    return toSettings(result.rows[0]);
  });

  app.get("/api/chat-settings", { preHandler: app.requireAuth }, async () => {
    const result = await pool.query<SettingsRow>("SELECT registration_open, max_image_size_mb, max_file_size_mb, max_message_length FROM server_settings WHERE singleton = true");
    const settings = toSettings(result.rows[0]);
    return { maxImageSizeMb: settings.maxImageSizeMb, maxFileSizeMb: settings.maxFileSizeMb, maxMessageLength: settings.maxMessageLength };
  });

  app.get("/api/admin/users", { preHandler: [app.requireAuth, requireAnyCapability("manage_server", "moderate")] }, async (req, reply) => {
    const query = listUsersQuerySchema.safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: "invalid query" });
    const { search, page, limit } = query.data;
    const filter = search ? "WHERE u.username ILIKE $1" : "";
    const filterParams = search ? [`%${search}%`] : [];
    const [result, count] = await Promise.all([
      pool.query<AdminUserRow>(
        `${adminUserSelect} ${filter} ORDER BY u.username LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}`,
        [...filterParams, limit, (page - 1) * limit],
      ),
      pool.query<{ count: string }>(`SELECT count(*) FROM users u ${filter}`, filterParams),
    ]);
    return { users: result.rows.map(toAdminUser), total: Number(count.rows[0].count) };
  });

  app.patch("/api/admin/users/:id", { preHandler: [app.requireAuth, requireCapability("manage_server")] }, async (req, reply) => {
    const params = idSchema.safeParse(req.params);
    const body = capabilitiesSchema.safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid payload" });
    const capabilities = [...new Set(body.data.capabilities)];
    if (params.data.id === req.user!.id && !capabilities.includes("manage_server")) {
      const others = await pool.query(
        "SELECT 1 FROM user_capabilities WHERE capability = 'manage_server' AND user_id != $1",
        [params.data.id],
      );
      if (!others.rowCount) return reply.code(409).send({ error: "cannot remove manage_server from the last holder" });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const exists = await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [params.data.id]);
      if (!exists.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "user not found" });
      }
      await client.query("DELETE FROM user_capabilities WHERE user_id = $1", [params.data.id]);
      for (const capability of capabilities) {
        await client.query("INSERT INTO user_capabilities (user_id, capability) VALUES ($1, $2)", [params.data.id, capability]);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    hub.updateCapabilities(params.data.id, capabilities);
    return toAdminUser((await fetchAdminUser(pool, params.data.id))!);
  });

  // Revokes every active session for the user and force-closes their live
  // WebSocket connections. Does not touch capabilities or ban state — a
  // kicked user can simply log back in, unlike a ban.
  async function kickUser(userId: string): Promise<void> {
    const rooms = Object.entries(voicePresence.allOccupancy())
      .filter(([, participants]) => participants.some((participant) => participant.userId === userId))
      .map(([room]) => room);
    await Promise.all(rooms.map((room) => voiceAdmin.removeParticipant(room, userId)));
    await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
    hub.disconnect(userId, 4001, "kicked");
  }

  app.patch("/api/admin/users/:id/voice-mute", { preHandler: [app.requireAuth, requireCapability("moderate")] }, async (req, reply) => {
    const params = idSchema.safeParse(req.params);
    const body = z.object({ muted: z.boolean() }).safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid payload" });
    if (params.data.id === req.user!.id) return reply.code(409).send({ error: "cannot voice-mute yourself" });
    const result = await pool.query<{ capabilities: Capability[] }>(
      `UPDATE users SET voice_muted = $1 WHERE id = $2 RETURNING
       ARRAY(SELECT capability FROM user_capabilities WHERE user_id = $2) AS capabilities`,
      [body.data.muted, params.data.id],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "user not found" });
    const canPublish = !body.data.muted && result.rows[0].capabilities.includes("publish_voice");
    const rooms = Object.entries(voicePresence.allOccupancy())
      .filter(([, participants]) => participants.some((participant) => participant.userId === params.data.id))
      .map(([room]) => room);
    await Promise.all(rooms.map((room) => voiceAdmin.setParticipantPublishing(room, params.data.id, canPublish)));
    return toAdminUser((await fetchAdminUser(pool, params.data.id))!);
  });

  app.post("/api/admin/users/:id/kick", { preHandler: [app.requireAuth, requireCapability("moderate")] }, async (req, reply) => {
    const params = idSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid payload" });
    const exists = await pool.query("SELECT id FROM users WHERE id = $1", [params.data.id]);
    if (!exists.rowCount) return reply.code(404).send({ error: "user not found" });
    await kickUser(params.data.id);
    return { ok: true };
  });

  app.post("/api/admin/users/:id/ban", { preHandler: [app.requireAuth, requireCapability("moderate")] }, async (req, reply) => {
    const params = idSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid payload" });
    if (params.data.id === req.user!.id) {
      return reply.code(409).send({ error: "cannot ban yourself" });
    }
    const result = await pool.query("UPDATE users SET banned_at = now() WHERE id = $1 RETURNING id", [params.data.id]);
    if (!result.rowCount) return reply.code(404).send({ error: "user not found" });
    await kickUser(params.data.id);
    return toAdminUser((await fetchAdminUser(pool, params.data.id))!);
  });

  app.post("/api/admin/users/:id/unban", { preHandler: [app.requireAuth, requireCapability("moderate")] }, async (req, reply) => {
    const params = idSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid payload" });
    const result = await pool.query("UPDATE users SET banned_at = NULL WHERE id = $1 RETURNING id", [params.data.id]);
    if (!result.rowCount) return reply.code(404).send({ error: "user not found" });
    return toAdminUser((await fetchAdminUser(pool, params.data.id))!);
  });
}
