import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { getBuild, getVersion } from "../version.js";

const CHANGELOG_PATH = new URL("../../../CHANGELOG.md", import.meta.url);

export function registerVersionRoutes(app: FastifyInstance): void {
  app.get("/api/version", async () => ({ version: getVersion(), build: getBuild() }));
  app.get("/api/changelog", async (_request, reply) => {
    try { return reply.type("text/plain; charset=utf-8").send(readFileSync(CHANGELOG_PATH, "utf8")); }
    catch { return reply.code(404).type("text/plain; charset=utf-8").send("changelog not found"); }
  });
}
