import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { z } from "zod";
import type { WsHub } from "../ws/hub.js";

async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (req.user?.role !== "admin") await reply.code(403).send({ error: "admin only" });
}

const roleSchema = z.object({ role: z.enum(["admin", "moderator", "member"]) });
const idSchema = z.object({ id: z.uuid() });

export function registerAdminRoutes(app: FastifyInstance, pool: pg.Pool, hub: WsHub): void {
  app.get("/api/registration-status", async () => {
    const result = await pool.query<{ registration_open: boolean }>("SELECT registration_open FROM server_settings WHERE singleton = true");
    return { registrationOpen: result.rows[0]?.registration_open ?? true };
  });

  app.get("/api/admin/settings", { preHandler: [app.requireAuth, requireAdmin] }, async () => {
    const result = await pool.query<{ registration_open: boolean }>("SELECT registration_open FROM server_settings WHERE singleton = true");
    return { registrationOpen: result.rows[0]?.registration_open ?? true };
  });

  app.patch("/api/admin/settings", { preHandler: [app.requireAuth, requireAdmin] }, async (req, reply) => {
    const body = z.object({ registrationOpen: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid payload" });
    await pool.query("UPDATE server_settings SET registration_open = $1 WHERE singleton = true", [body.data.registrationOpen]);
    return { registrationOpen: body.data.registrationOpen };
  });

  app.get("/api/admin/users", { preHandler: [app.requireAuth, requireAdmin] }, async () => {
    const result = await pool.query<{ id: string; username: string; role: string; created_at: Date }>(
      "SELECT id, username, role, created_at FROM users ORDER BY username",
    );
    return result.rows.map((user) => ({ id: user.id, username: user.username, role: user.role, createdAt: user.created_at }));
  });

  app.patch("/api/admin/users/:id", { preHandler: [app.requireAuth, requireAdmin] }, async (req, reply) => {
    const params = idSchema.safeParse(req.params);
    const body = roleSchema.safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid payload" });
    if (params.data.id === req.user!.id && body.data.role !== "admin") {
      const admins = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 2");
      if (admins.rowCount === 1) return reply.code(409).send({ error: "cannot demote the last admin" });
    }
    const result = await pool.query<{ id: string; username: string; role: string; created_at: Date }>(
      "UPDATE users SET role = $1 WHERE id = $2 RETURNING id, username, role, created_at",
      [body.data.role, params.data.id],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "user not found" });
    const user = result.rows[0];
    hub.updateRole(user.id, user.role as "admin" | "moderator" | "member");
    return { id: user.id, username: user.username, role: user.role, createdAt: user.created_at };
  });
}
