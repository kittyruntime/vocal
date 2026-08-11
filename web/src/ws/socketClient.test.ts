import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSocketClient } from "./socketClient";

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  static reset() { FakeWebSocket.instances = []; }
  listeners: Record<string, ((ev: unknown) => void)[]> = {};
  readyState = FakeWebSocket.OPEN;
  send = vi.fn();
  constructor(public url: string) { FakeWebSocket.instances.push(this); }
  addEventListener(type: string, cb: (ev: unknown) => void) { (this.listeners[type] ??= []).push(cb); }
  close() { this.emit("close", {}); }
  emit(type: string, ev: unknown = {}) { this.listeners[type]?.forEach((cb) => cb(ev)); }
}

beforeEach(() => {
  FakeWebSocket.reset();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("createSocketClient", () => {
  it("connects immediately and reports status changes", () => {
    const onStatusChange = vi.fn();
    createSocketClient("ws://x/ws", { onEvent: vi.fn(), onStatusChange });
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(onStatusChange).toHaveBeenCalledWith("connecting");
    FakeWebSocket.instances[0].emit("open");
    expect(onStatusChange).toHaveBeenCalledWith("open");
  });

  it("parses valid JSON messages and forwards them", () => {
    const onEvent = vi.fn();
    createSocketClient("ws://x/ws", { onEvent, onStatusChange: vi.fn() });
    FakeWebSocket.instances[0].emit("message", { data: JSON.stringify({ type: "pong" }) });
    expect(onEvent).toHaveBeenCalledWith({ type: "pong" });
  });

  it("sends a heartbeat often enough to keep the reverse proxy connection alive", () => {
    const client = createSocketClient("ws://x/ws", { onEvent: vi.fn(), onStatusChange: vi.fn() });
    const socket = FakeWebSocket.instances[0];
    socket.emit("open");
    vi.advanceTimersByTime(24_999);
    expect(socket.send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "ping" }));
    client.close();
  });

  it("stops the old heartbeat when reconnecting", () => {
    createSocketClient("ws://x/ws", { onEvent: vi.fn(), onStatusChange: vi.fn() });
    const first = FakeWebSocket.instances[0];
    first.emit("open");
    first.emit("close");
    vi.advanceTimersByTime(500);
    const second = FakeWebSocket.instances[1];
    second.emit("open");
    vi.advanceTimersByTime(25_000);
    expect(first.send).not.toHaveBeenCalled();
    expect(second.send).toHaveBeenCalledTimes(1);
  });

  it("ignores malformed messages without throwing", () => {
    const onEvent = vi.fn();
    createSocketClient("ws://x/ws", { onEvent, onStatusChange: vi.fn() });
    expect(() => FakeWebSocket.instances[0].emit("message", { data: "not json" })).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("reconnects with exponential backoff after an unexpected close", () => {
    createSocketClient("ws://x/ws", { onEvent: vi.fn(), onStatusChange: vi.fn() });
    FakeWebSocket.instances[0].emit("close");
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.instances[1].emit("close");
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it("resets the backoff after a successful open", () => {
    createSocketClient("ws://x/ws", { onEvent: vi.fn(), onStatusChange: vi.fn() });
    FakeWebSocket.instances[0].emit("close");
    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.instances[1].emit("open");
    FakeWebSocket.instances[1].emit("close");
    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it("does not reconnect after close() is called by the caller", () => {
    const client = createSocketClient("ws://x/ws", { onEvent: vi.fn(), onStatusChange: vi.fn() });
    client.close();
    vi.advanceTimersByTime(20_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
