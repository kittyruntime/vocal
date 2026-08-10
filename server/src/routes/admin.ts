import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import type { WsHub } from "../ws/hub.js";
import { CAPABILITIES, type Capability } from "../capabilities.js";
import { requireCapability } from "../auth/guard.js";

const capabilitiesSchema = z.object({ capabilities: z.array(z.enum(CAPABILITIES)) });
const idSchema = z.object({ id: z.uuid() });

type AdminUserRow = { id: string; username: string; created_at: Date; banned_at: Date | null; capabilities: Capability[] };

async function fetchAdminUser(pool: pg.Pool, userId: string): Promise<AdminUserRow | null> {
  const result = await pool.query<AdminUserRow>(
    `SELECT u.id, u.username, u.created_at, u.banned_at,
       COALESCE(array_agg(uc.capability) FILTER (WHERE uc.capability IS NOT NULL), '{}') AS capabilities
     FROM users u LEFT JOIN user_capabilities uc ON uc.user_id = u.id
     WHERE u.id = $1
     GROUP BY u.id, u.username, u.created_at, u.banned_at`,
    [userId],
  );
  return result.rows[0] ?? null;
}

function toAdminUser(row: AdminUserRow) {
  return { id: row.id, username: row.username, capabilities: row.capabilities, createdAt: row.created_at, bannedAt: row.banned_at };
}

export function registerAdminRoutes(app: FastifyInstance, pool: pg.Pool, hub: WsHub): void {
  app.get("/api/registration-status", async () => {
    const result = await pool.query<{ registration_open: boolean }>("SELECT registration_open FROM server_settings WHERE singleton = true");
    return { registrationOpen: result.rows[0]?.registration_open ?? true };
  });

  app.get("/api/admin/settings", { preHandler: [app.requireAuth, requireCapability("manage_server")] }, async () => {
    const result = await pool.query<{ registration_open: boolean }>("SELECT registration_open FROM server_settings WHERE singleton = true");
    return { registrationOpen: result.rows[0]?.registration_open ?? true };
  });

  app.patch("/api/admin/settings", { preHandler: [app.requireAuth, requireCapability("manage_server")] }, async (req, reply) => {
    const body = z.object({ registrationOpen: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid payload" });
    await pool.query("UPDATE server_settings SET registration_open = $1 WHERE singleton = true", [body.data.registrationOpen]);
    return { registrationOpen: body.data.registrationOpen };
  });

  app.get("/api/admin/users", { preHandler: [app.requireAuth, requireCapability("manage_server")] }, async () => {
    const result = await pool.query<AdminUserRow>(
      `SELECT u.id, u.username, u.created_at, u.banned_at,
         COALESCE(array_agg(uc.capability) FILTER (WHERE uc.capability IS NOT NULL), '{}') AS capabilities
       FROM users u LEFT JOIN user_capabilities uc ON uc.user_id = u.id
       GROUP BY u.id, u.username, u.created_at, u.banned_at
       ORDER BY u.username`,
    );
    return result.rows.map(toAdminUser);
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
    await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
    hub.disconnect(userId, 4001, "kicked");
  }

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
