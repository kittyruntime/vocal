import type { FastifyInstance, FastifyRequest } from "fastify";
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

// Guards against Cross-Site WebSocket Hijacking: browsers attach the sid cookie
// to cross-origin WS handshakes (CORS does not apply to WebSocket), so a session
// cookie alone is not proof the handshake came from our own page. A missing Origin
// means a non-browser client (no ambient cookie, no CSWSH risk) and is allowed.
function isAllowedOrigin(req: FastifyRequest): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const configured = process.env.APP_ORIGIN;
  if (configured) {
    const allowlist = configured.split(",").map((o) => o.trim());
    return allowlist.includes(origin);
  }
  // Default: same-origin — the Origin's host must match the request Host.
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function registerWsRoute(app: FastifyInstance, pool: pg.Pool, hub: WsHub): void {
  app.get("/ws", { websocket: true }, async (socket, req) => {
    if (!isAllowedOrigin(req)) {
      socket.close(1008, "bad origin");
      return;
    }
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
