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

const channel: Channel = { id: "c1", name: "général", type: "text", minRole: "member", position: 0, createdAt: "now" };

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
    const input = screen.getByLabelText("Message dans général");
    await user.type(input, "salut");
    await user.click(screen.getByRole("button", { name: "Envoyer" }));
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
    expect(api.listMessages).toHaveBeenLastCalledWith("c1", { before: "2026-01-01T00:00:01Z" });
  });
});
