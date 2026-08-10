import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../toast/ToastContext";
import { ChatView } from "./ChatView";
import * as api from "../api/client";
import type { Channel, Message } from "../api/client";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, listMessages: vi.fn(), postMessage: vi.fn() };
});

const channel: Channel = { id: "c1", name: "général", type: "text", requiredCapability: null, position: 0, createdAt: "now" };

function msg(id: string, content: string, createdAt: string): Message {
  return { id, channelId: "c1", userId: "u1", username: "theo", content, createdAt };
}

beforeEach(() => {
  vi.mocked(api.listMessages).mockReset();
  vi.mocked(api.postMessage).mockReset();
});

function renderChat(messages: Message[] = [], onLoaded = vi.fn(), onPrepended = vi.fn()) {
  render(
    <ToastProvider>
      <ChatView channel={channel} messages={messages} onMessagesLoaded={onLoaded} onMessagesPrepended={onPrepended} />
    </ToastProvider>,
  );
}

describe("ChatView", () => {
  it("loads history on mount and reports it oldest-first", async () => {
    vi.mocked(api.listMessages).mockResolvedValue([
      msg("3", "c", "2026-01-01T00:00:03Z"),
      msg("2", "b", "2026-01-01T00:00:02Z"),
      msg("1", "a", "2026-01-01T00:00:01Z"),
    ]);
    const onLoaded = vi.fn();
    renderChat([], onLoaded);
    await waitFor(() =>
      expect(onLoaded).toHaveBeenCalledWith([
        msg("1", "a", "2026-01-01T00:00:01Z"),
        msg("2", "b", "2026-01-01T00:00:02Z"),
        msg("3", "c", "2026-01-01T00:00:03Z"),
      ]),
    );
    expect(api.listMessages).toHaveBeenCalledWith("c1", { limit: 50 });
  });

  it("scrolls to the bottom once the initial history for a channel loads", async () => {
    vi.mocked(api.listMessages).mockResolvedValue([
      msg("2", "b", "2026-01-01T00:00:02Z"),
      msg("1", "a", "2026-01-01T00:00:01Z"),
    ]);
    const onLoaded = vi.fn();
    const { rerender } = render(
      <ToastProvider>
        <ChatView channel={channel} messages={[]} onMessagesLoaded={onLoaded} onMessagesPrepended={vi.fn()} />
      </ToastProvider>,
    );
    const log = screen.getByRole("log");
    Object.defineProperty(log, "scrollHeight", { value: 800, configurable: true });
    Object.defineProperty(log, "scrollTop", { value: 0, configurable: true, writable: true });

    await waitFor(() => expect(onLoaded).toHaveBeenCalled());
    const loaded = onLoaded.mock.calls[0][0] as Message[];
    rerender(
      <ToastProvider>
        <ChatView channel={channel} messages={loaded} onMessagesLoaded={onLoaded} onMessagesPrepended={vi.fn()} />
      </ToastProvider>,
    );

    await waitFor(() => expect(log.scrollTop).toBe(800));
  });

  it("preserves scroll position when older messages are prepended, instead of jumping", async () => {
    const initialMessages = [msg("1", "a", "2026-01-01T00:00:01Z")];
    // A full page (>= PAGE_SIZE) so the component believes there's older history to load
    // (hasMore stays true); the actual props shown below are set independently via rerender.
    const fullPage = Array.from({ length: 50 }, (_, i) => msg(`seed-${i}`, "x", "2020-01-01T00:00:00Z"));
    vi.mocked(api.listMessages)
      .mockResolvedValueOnce(fullPage) // initial history load
      .mockResolvedValueOnce([msg("0", "plus vieux", "2025-12-31T00:00:00Z")]); // loadMore

    const onPrepended = vi.fn();
    const { rerender } = render(
      <ToastProvider>
        <ChatView channel={channel} messages={[]} onMessagesLoaded={vi.fn()} onMessagesPrepended={onPrepended} />
      </ToastProvider>,
    );

    // Let the initial load resolve, then have the parent hand the loaded messages back down
    // as props -- this consumes the "scroll to bottom on load" behavior so it doesn't
    // interfere with the prepend assertion below.
    await waitFor(() => expect(api.listMessages).toHaveBeenCalledTimes(1));
    rerender(
      <ToastProvider>
        <ChatView
          channel={channel}
          messages={initialMessages}
          onMessagesLoaded={vi.fn()}
          onMessagesPrepended={onPrepended}
        />
      </ToastProvider>,
    );

    const log = screen.getByRole("log");
    Object.defineProperty(log, "scrollHeight", { value: 500, configurable: true });
    Object.defineProperty(log, "scrollTop", { value: 30, configurable: true, writable: true });

    log.dispatchEvent(new Event("scroll", { bubbles: true }));
    await waitFor(() => expect(onPrepended).toHaveBeenCalled());
    expect(api.listMessages).toHaveBeenLastCalledWith("c1", { before: "2026-01-01T00:00:01Z", limit: 50 });

    // The DOM grows taller once older messages are added, before scroll gets restored.
    Object.defineProperty(log, "scrollHeight", { value: 700, configurable: true });

    const prepended = [msg("0", "plus vieux", "2025-12-31T00:00:00Z"), ...initialMessages];
    rerender(
      <ToastProvider>
        <ChatView
          channel={channel}
          messages={prepended}
          onMessagesLoaded={vi.fn()}
          onMessagesPrepended={onPrepended}
        />
      </ToastProvider>,
    );

    // scrollTop should be shifted by the height delta (700 - 500 = 200) so the previously
    // visible message stays in the same place, instead of jumping to the top.
    await waitFor(() => expect(log.scrollTop).toBe(230));
  });

  it("renders provided messages in order", () => {
    renderChat([msg("1", "premier", "2026-01-01T00:00:01Z"), msg("2", "second", "2026-01-01T00:00:02Z")]);
    const rendered = screen.getAllByText(/premier|second/);
    expect(rendered.map((el) => el.textContent)).toEqual(["premier", "second"]);
  });

  it("sends a message and clears the composer", async () => {
    vi.mocked(api.listMessages).mockResolvedValue([]);
    vi.mocked(api.postMessage).mockResolvedValue(msg("1", "salut", "2026-01-01T00:00:01Z"));
    renderChat([]);
    const user = userEvent.setup();
    const input = screen.getByLabelText("Message in général");
    await user.type(input, "salut");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(api.postMessage).toHaveBeenCalledWith("c1", "salut"));
    expect(input).toHaveValue("");
  });

  it("loads older messages when scrolled to the top", async () => {
    vi.mocked(api.listMessages)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([msg("0", "plus vieux", "2025-12-31T00:00:00Z")]);
    const onPrepended = vi.fn();
    renderChat([msg("1", "a", "2026-01-01T00:00:01Z")], vi.fn(), onPrepended);
    const container = screen.getByRole("log");
    Object.defineProperty(container, "scrollTop", { value: 10, configurable: true });
    container.dispatchEvent(new Event("scroll", { bubbles: true }));
    await waitFor(() => expect(onPrepended).toHaveBeenCalledWith([msg("0", "plus vieux", "2025-12-31T00:00:00Z")]));
    expect(api.listMessages).toHaveBeenLastCalledWith("c1", { before: "2026-01-01T00:00:01Z", limit: 50 });
  });
});
