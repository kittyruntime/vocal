import { hasAtLeastRole, type Role } from "../roles.js";
import type { ServerEvent } from "./protocol.js";

export interface WsLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface WsHub {
  add(userId: string, role: Role, socket: WsLike): void;
  remove(userId: string, socket: WsLike): void;
  updateRole(userId: string, role: Role): void;
  broadcast(event: ServerEvent): void;
  broadcastToRole(minRole: Role, event: ServerEvent): void;
  onlineUserIds(): string[];
  disconnect(userId: string, code: number, reason: string): void;
}

export function createHub(): WsHub {
  // userId -> { role, sockets } (a user may have several tabs/devices)
  const byUser = new Map<string, { role: Role; sockets: Set<WsLike> }>();

  function send(socket: WsLike, event: ServerEvent): void {
    socket.send(JSON.stringify(event));
  }

  // Broadcast to every connected socket except `exclude` (used so a newly
  // connecting socket doesn't receive its own presence.online echo ahead of
  // the presence.sync snapshot the route handler sends it directly).
  function broadcastExcept(exclude: WsLike, event: ServerEvent): void {
    for (const { sockets } of byUser.values()) {
      for (const socket of sockets) {
        if (socket !== exclude) send(socket, event);
      }
    }
  }

  return {
    add(userId, role, socket) {
      let entry = byUser.get(userId);
      const wasOffline = !entry || entry.sockets.size === 0;
      if (!entry) {
        entry = { role, sockets: new Set() };
        byUser.set(userId, entry);
      } else {
        entry.role = role;
      }
      entry.sockets.add(socket);
      if (wasOffline) {
        broadcastExcept(socket, { type: "presence.online", userId });
      }
    },
    remove(userId, socket) {
      const entry = byUser.get(userId);
      if (!entry) return;
      entry.sockets.delete(socket);
      if (entry.sockets.size === 0) {
        byUser.delete(userId);
        this.broadcast({ type: "presence.offline", userId });
      }
    },
    updateRole(userId, role) {
      const entry = byUser.get(userId);
      if (entry) entry.role = role;
    },
    broadcast(event) {
      for (const { sockets } of byUser.values()) {
        for (const socket of sockets) send(socket, event);
      }
    },
    broadcastToRole(minRole, event) {
      for (const { role, sockets } of byUser.values()) {
        if (!hasAtLeastRole(role, minRole)) continue;
        for (const socket of sockets) send(socket, event);
      }
    },
    onlineUserIds() {
      return [...byUser.keys()];
    },
    disconnect(userId, code, reason) {
      const entry = byUser.get(userId);
      if (!entry) return;
      // Each socket's own "close" handler calls hub.remove(), which tears
      // down the byUser entry and broadcasts presence.offline once the last
      // socket is gone — no need to mutate `byUser` here directly.
      for (const socket of entry.sockets) socket.close(code, reason);
    },
  };
}
