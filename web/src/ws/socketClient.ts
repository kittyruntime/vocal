import type { ClientEvent, ServerEvent } from "./protocol";

export type ConnectionStatus = "connecting" | "open" | "closed";

export type SocketHandlers = {
  onEvent(event: ServerEvent): void;
  onStatusChange(status: ConnectionStatus): void;
};

export type SocketClient = { close(): void; send(event: ClientEvent): void };

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;

export function createSocketClient(url: string, handlers: SocketHandlers): SocketClient {
  let backoff = INITIAL_BACKOFF_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closedByCaller = false;
  let currentSocket: WebSocket | null = null;

  function connect(): void {
    handlers.onStatusChange("connecting");
    const socket = new WebSocket(url);
    currentSocket = socket;

    socket.addEventListener("open", () => {
      backoff = INITIAL_BACKOFF_MS;
      handlers.onStatusChange("open");
    });

    socket.addEventListener("message", (ev: MessageEvent) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (typeof parsed === "object" && parsed !== null && "type" in parsed) {
        handlers.onEvent(parsed as ServerEvent);
      }
    });

    socket.addEventListener("close", () => {
      handlers.onStatusChange("closed");
      if (closedByCaller) return;
      timer = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    });
  }

  connect();

  return {
    send(event) {
      if (currentSocket?.readyState === WebSocket.OPEN && typeof currentSocket.send === "function") currentSocket.send(JSON.stringify(event));
    },
    close() {
      closedByCaller = true;
      if (timer) clearTimeout(timer);
      currentSocket?.close();
    },
  };
}
