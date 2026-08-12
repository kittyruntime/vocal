import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { requireCapability } from "../auth/guard.js";

export const ACCENT_PRESETS = ["amber", "ember-red", "magenta", "glacier", "emerald"] as const;
export type AccentPreset = (typeof ACCENT_PRESETS)[number];

const patchAppearanceSchema = z.object({
  enabledPresets: z.array(z.enum(ACCENT_PRESETS)).min(1).optional(),
  defaultPreset: z.enum(ACCENT_PRESETS).optional(),
});
const patchAccentSchema = z.object({
  accentPreset: z.enum(ACCENT_PRESETS).nullable(),
});

type AppearanceRow = { enabled_accent_presets: AccentPreset[]; default_accent_preset: AccentPreset };

export function registerAppearanceRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.get("/api/appearance", async () => {
    const result = await pool.query<AppearanceRow>("SELECT enabled_accent_presets, default_accent_preset FROM server_settings WHERE singleton = true");
    const row = result.rows[0];
    return {
      enabledPresets: row?.enabled_accent_presets ?? ACCENT_PRESETS,
      defaultPreset: row?.default_accent_preset ?? "amber",
    };
  });

  app.patch("/api/admin/appearance", { preHandler: [app.requireAuth, requireCapability("manage_server")] }, async (req, reply) => {
    const body = patchAppearanceSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid payload" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<AppearanceRow>(
        "SELECT enabled_accent_presets, default_accent_preset FROM server_settings WHERE singleton = true FOR UPDATE",
      );
      const resultingEnabled = body.data.enabledPresets ?? current.rows[0].enabled_accent_presets;
      const resultingDefault = body.data.defaultPreset ?? current.rows[0].default_accent_preset;
      if (!resultingEnabled.includes(resultingDefault)) {
        await client.query("ROLLBACK");
        return reply.code(400).send({ error: "default preset must be one of the enabled presets" });
      }
      const result = await client.query<AppearanceRow>(
        `UPDATE server_settings SET
           enabled_accent_presets = $1,
           default_accent_preset = $2
         WHERE singleton = true RETURNING enabled_accent_presets, default_accent_preset`,
        [resultingEnabled, resultingDefault],
      );
      await client.query("COMMIT");
      return { enabledPresets: result.rows[0].enabled_accent_presets, defaultPreset: result.rows[0].default_accent_preset };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  app.get("/api/me/accent", { preHandler: app.requireAuth }, async (req) => {
    const result = await pool.query<{ accent_preset: AccentPreset | null }>("SELECT accent_preset FROM users WHERE id = $1", [req.user!.id]);
    return { accentPreset: result.rows[0]?.accent_preset ?? null };
  });

  app.patch("/api/me/accent", { preHandler: app.requireAuth }, async (req, reply) => {
    const body = patchAccentSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid payload" });
    const appearance = await pool.query<{ enabled_accent_presets: AccentPreset[] }>("SELECT enabled_accent_presets FROM server_settings WHERE singleton = true");
    const enabled = appearance.rows[0]?.enabled_accent_presets ?? ACCENT_PRESETS;
    if (body.data.accentPreset !== null && !enabled.includes(body.data.accentPreset)) {
      return reply.code(400).send({ error: "that preset is not currently enabled" });
    }
    const result = await pool.query<{ accent_preset: AccentPreset | null }>(
      "UPDATE users SET accent_preset = $1 WHERE id = $2 RETURNING accent_preset",
      [body.data.accentPreset, req.user!.id],
    );
    return { accentPreset: result.rows[0].accent_preset };
  });
}
