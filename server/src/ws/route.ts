import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { getSessionUser } from "../auth/sessions.js";
import type { WsHub } from "./hub.js";

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function registerWsRoute(app: FastifyInstance, pool: pg.Pool, hub: WsHub): void {
  app.get("/ws", { websocket: true }, async (socket, req) => {
    const token = parseCookie(req.headers.cookie, "sid");
    const user = token ? await getSessionUser(pool, token) : null;
    if (!user) {
      socket.close(1008, "unauthorized");
      return;
    }
    hub.add(user.id, user.role, socket);
    socket.send(JSON.stringify({ type: "presence.sync", userIds: hub.onlineUserIds() }));

    socket.on("message", (raw: Buffer) => {
      let event: unknown;
      try {
        event = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown }).type === "ping"
      ) {
        socket.send(JSON.stringify({ type: "pong" }));
      }
    });

    socket.on("close", () => {
      hub.remove(user.id, socket);
    });
  });
}
