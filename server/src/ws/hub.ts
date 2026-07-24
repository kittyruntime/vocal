import type { ServerEvent } from "./protocol.js";

export interface WsLike {
  send(data: string): void;
}

export interface WsHub {
  add(userId: string, socket: WsLike): void;
  remove(userId: string, socket: WsLike): void;
  broadcast(event: ServerEvent): void;
  onlineUserIds(): string[];
}

export function createHub(): WsHub {
  // userId -> set of sockets (a user may have several tabs/devices)
  const byUser = new Map<string, Set<WsLike>>();

  function send(socket: WsLike, event: ServerEvent): void {
    socket.send(JSON.stringify(event));
  }

  // Broadcast to every connected socket except `exclude` (used so a newly
  // connecting socket doesn't receive its own presence.online echo ahead of
  // the presence.sync snapshot the route handler sends it directly).
  function broadcastExcept(exclude: WsLike, event: ServerEvent): void {
    for (const sockets of byUser.values()) {
      for (const socket of sockets) {
        if (socket !== exclude) send(socket, event);
      }
    }
  }

  return {
    add(userId, socket) {
      let sockets = byUser.get(userId);
      const wasOffline = !sockets || sockets.size === 0;
      if (!sockets) {
        sockets = new Set();
        byUser.set(userId, sockets);
      }
      sockets.add(socket);
      if (wasOffline) {
        broadcastExcept(socket, { type: "presence.online", userId });
      }
    },
    remove(userId, socket) {
      const sockets = byUser.get(userId);
      if (!sockets) return;
      sockets.delete(socket);
      if (sockets.size === 0) {
        byUser.delete(userId);
        this.broadcast({ type: "presence.offline", userId });
      }
    },
    broadcast(event) {
      for (const sockets of byUser.values()) {
        for (const socket of sockets) send(socket, event);
      }
    },
    onlineUserIds() {
      return [...byUser.keys()];
    },
  };
}
