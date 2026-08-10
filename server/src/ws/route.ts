import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";
import { getSessionUser } from "../auth/sessions.js";
import { hasAtLeastRole, type Role } from "../roles.js";
import type { WsHub } from "./hub.js";
import type { VoicePresence } from "../voice/presence.js";
import type { VoiceParticipantPayload } from "./protocol.js";

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

// Returns the subset of `occupancy` (channelId -> userIds) for voice channels
// whose min_role is satisfied by `role`, skipping empty entries.
async function visibleVoiceOccupancy(
  pool: pg.Pool, role: Role, occupancy: Record<string, VoiceParticipantPayload[]>,
): Promise<Record<string, VoiceParticipantPayload[]>> {
  const res = await pool.query<{ id: string; min_role: string }>(
    "SELECT id, min_role FROM channels WHERE type = 'voice'",
  );
  const visible: Record<string, VoiceParticipantPayload[]> = {};
  for (const row of res.rows) {
    const occupants = occupancy[row.id];
    if (occupants && occupants.length > 0 && hasAtLeastRole(role, row.min_role as Role)) {
      visible[row.id] = occupants;
    }
  }
  return visible;
}

export function registerWsRoute(
  app: FastifyInstance, pool: pg.Pool, hub: WsHub, voicePresence: VoicePresence,
): void {
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
    // Compute the voice occupancy snapshot BEFORE registering the socket with the
    // hub. hub.add() makes this socket eligible to receive live voice.joined /
    // voice.left broadcasts from concurrent webhook deliveries; if that await'ed
    // DB query ran after hub.add(), a broadcast could land in the gap and this
    // socket would then send a stale voice.sync that appears to "undo" an event
    // the client already received. No await may occur between hub.add() and the
    // final socket.send() below — both sends are queued back-to-back.
    const channels = await visibleVoiceOccupancy(pool, user.role, voicePresence.allOccupancy());

    hub.add(user.id, user.role, socket);
    socket.send(JSON.stringify({ type: "presence.sync", userIds: hub.onlineUserIds() }));
    socket.send(JSON.stringify({ type: "voice.sync", channels }));

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
