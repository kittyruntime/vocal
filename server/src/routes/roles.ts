import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { CAPABILITIES, type Capability } from "../capabilities.js";
import { requireCapability } from "../auth/guard.js";
import type { WsHub } from "../ws/hub.js";

const idSchema = z.object({ id: z.uuid() });
const roleSchema = z.object({
  name: z.string().trim().min(1).max(32),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  capabilities: z.array(z.enum(CAPABILITIES)),
});

async function rolePayload(pool: pg.Pool, roleId: string) {
  const result = await pool.query(
    `SELECT r.id, r.name, r.color, r.position,
       ARRAY(SELECT capability FROM role_capabilities WHERE role_id = r.id ORDER BY capability) AS capabilities,
       (SELECT count(*)::int FROM user_roles WHERE role_id = r.id) AS "memberCount"
     FROM roles r WHERE r.id = $1`, [roleId],
  );
  return result.rows[0] ?? null;
}

async function effectiveCapabilities(pool: pg.Pool, userId: string): Promise<Capability[]> {
  const result = await pool.query<{ capability: Capability }>(
    `SELECT capability FROM user_capabilities WHERE user_id = $1
     UNION SELECT rc.capability FROM user_roles ur JOIN role_capabilities rc ON rc.role_id = ur.role_id WHERE ur.user_id = $1`, [userId],
  );
  return result.rows.map((row) => row.capability);
}

export function registerRoleRoutes(app: FastifyInstance, pool: pg.Pool, hub: WsHub): void {
  app.get("/api/admin/roles", { preHandler: [app.requireAuth, requireCapability("manage_server")] }, async () => {
    const roles = await pool.query<{ id: string }>("SELECT id FROM roles ORDER BY position DESC, name");
    return Promise.all(roles.rows.map((role) => rolePayload(pool, role.id)));
  });

  app.post("/api/admin/roles", { preHandler: [app.requireAuth, requireCapability("manage_server")] }, async (req, reply) => {
    const body = roleSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid role" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query<{ id: string }>("INSERT INTO roles (name, color, position) VALUES ($1, $2, (SELECT COALESCE(max(position), 0) + 1 FROM roles)) RETURNING id", [body.data.name, body.data.color]);
      for (const capability of new Set(body.data.capabilities)) await client.query("INSERT INTO role_capabilities (role_id, capability) VALUES ($1, $2)", [inserted.rows[0].id, capability]);
      await client.query("COMMIT");
      return reply.code(201).send(await rolePayload(pool, inserted.rows[0].id));
    } catch (error: any) {
      await client.query("ROLLBACK");
      if (error?.code === "23505") return reply.code(409).send({ error: "role name already exists" });
      throw error;
    } finally { client.release(); }
  });

  app.patch("/api/admin/roles/:id", { preHandler: [app.requireAuth, requireCapability("manage_server")] }, async (req, reply) => {
    const params = idSchema.safeParse(req.params); const body = roleSchema.safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid role" });
    const members = await pool.query<{ user_id: string }>("SELECT user_id FROM user_roles WHERE role_id = $1", [params.data.id]);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query("UPDATE roles SET name = $1, color = $2 WHERE id = $3 RETURNING id", [body.data.name, body.data.color, params.data.id]);
      if (!updated.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "role not found" }); }
      await client.query("DELETE FROM role_capabilities WHERE role_id = $1", [params.data.id]);
      for (const capability of new Set(body.data.capabilities)) await client.query("INSERT INTO role_capabilities (role_id, capability) VALUES ($1, $2)", [params.data.id, capability]);
      await client.query("COMMIT");
    } catch (error: any) { await client.query("ROLLBACK"); if (error?.code === "23505") return reply.code(409).send({ error: "role name already exists" }); throw error; }
    finally { client.release(); }
    for (const member of members.rows) hub.updateCapabilities(member.user_id, await effectiveCapabilities(pool, member.user_id));
    return rolePayload(pool, params.data.id);
  });

  app.delete("/api/admin/roles/:id", { preHandler: [app.requireAuth, requireCapability("manage_server")] }, async (req, reply) => {
    const params = idSchema.safeParse(req.params); if (!params.success) return reply.code(400).send({ error: "invalid role id" });
    const members = await pool.query<{ user_id: string }>("SELECT user_id FROM user_roles WHERE role_id = $1", [params.data.id]);
    const deleted = await pool.query("DELETE FROM roles WHERE id = $1", [params.data.id]);
    if (!deleted.rowCount) return reply.code(404).send({ error: "role not found" });
    for (const member of members.rows) hub.updateCapabilities(member.user_id, await effectiveCapabilities(pool, member.user_id));
    return reply.code(204).send();
  });

  app.put("/api/admin/users/:id/roles", { preHandler: [app.requireAuth, requireCapability("manage_server")] }, async (req, reply) => {
    const params = idSchema.safeParse(req.params); const body = z.object({ roleIds: z.array(z.uuid()).max(100) }).safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid role assignment" });
    const user = await pool.query("SELECT id FROM users WHERE id = $1", [params.data.id]); if (!user.rowCount) return reply.code(404).send({ error: "user not found" });
    const client = await pool.connect();
    try { await client.query("BEGIN"); await client.query("DELETE FROM user_roles WHERE user_id = $1", [params.data.id]); for (const roleId of new Set(body.data.roleIds)) await client.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)", [params.data.id, roleId]); await client.query("COMMIT"); }
    catch (error: any) { await client.query("ROLLBACK"); if (error?.code === "23503") return reply.code(400).send({ error: "unknown role" }); throw error; }
    finally { client.release(); }
    const capabilities = await effectiveCapabilities(pool, params.data.id); hub.updateCapabilities(params.data.id, capabilities);
    const roles = await pool.query("SELECT r.id, r.name, r.color FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = $1 ORDER BY r.position DESC", [params.data.id]);
    return { id: params.data.id, capabilities, roles: roles.rows };
  });
}
