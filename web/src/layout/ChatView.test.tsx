import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../toast/ToastContext";
import { ChatView } from "./ChatView";
import * as api from "../api/client";
import type { Channel, Message } from "../api/client";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, listMessages: vi.fn(), postMessage: vi.fn(), updateMessage: vi.fn(), deleteMessage: vi.fn(), addMessageReaction: vi.fn(), removeMessageReaction: vi.fn() };
});

const channel: Channel = { id: "c1", name: "général", type: "text", requiredCapability: null, position: 0, createdAt: "now" };

function msg(id: string, content: string, createdAt: string): Message {
  return { id, channelId: "c1", userId: "u1", username: "theo", content, createdAt };
}

beforeEach(() => {
  vi.mocked(api.listMessages).mockReset();
  vi.mocked(api.postMessage).mockReset();
  vi.mocked(api.updateMessage).mockReset();
  vi.mocked(api.deleteMessage).mockReset();
  vi.mocked(api.addMessageReaction).mockReset();
  vi.mocked(api.removeMessageReaction).mockReset();
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

  it("renders a raster image attachment inline but an SVG attachment as a plain file download", () => {
    // The server always forces SVG attachments to download (see the
    // INLINE_SAFE_MIME_TYPES allowlist in server/src/routes/messages.ts) --
    // it's an XML document that can carry executable script, unlike a
    // raster image. The client must not render it as an <img>, which would
    // either show a broken image (since the response won't render inline)
    // or, if it ever did render, could execute attacker-supplied script.
    const withAttachments: Message = {
      ...msg("1", "", "2026-01-01T00:00:01Z"),
      attachments: [
        { id: "a1", filename: "photo.png", mimeType: "image/png", size: 10, url: "/api/attachments/a1" },
        { id: "a2", filename: "evil.svg", mimeType: "image/svg+xml", size: 20, url: "/api/attachments/a2" },
      ],
    };
    renderChat([withAttachments]);
    expect(screen.getByAltText("photo.png")).toBeInTheDocument();
    expect(screen.queryByAltText("evil.svg")).not.toBeInTheDocument();
    expect(screen.getByText("evil.svg")).toBeInTheDocument();
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
    expect(input).toHaveFocus();
  });

  it("replies to a message through the composer", async () => {
    vi.mocked(api.listMessages).mockResolvedValue([]);
    vi.mocked(api.postMessage).mockResolvedValue(msg("2", "answer", "2026-01-01T00:00:02Z"));
    renderChat([msg("1", "original", "2026-01-01T00:00:01Z")]);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Reply" }));
    expect(screen.getByText(/Replying to/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Message in général"), "answer");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(api.postMessage).toHaveBeenCalledWith("c1", "answer", [], "1"));
  });

  it("inserts an emote in the composer and keeps keyboard focus", async () => {
    vi.mocked(api.listMessages).mockResolvedValue([]);
    renderChat([]);
    const user = userEvent.setup();
    const input = screen.getByLabelText("Message in général");
    await user.type(input, "salut ");
    await user.click(screen.getByRole("button", { name: "Choose an emote" }));
    expect(screen.getByRole("dialog", { name: "Emotes" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Insert 😀" }));
    expect(input).toHaveValue("salut 😀");
    await waitFor(() => expect(input).toHaveFocus());
  });

  it("sends an attachment without requiring text", async () => {
    vi.mocked(api.listMessages).mockResolvedValue([]);
    vi.mocked(api.postMessage).mockResolvedValue({ ...msg("1", "", "2026-01-01T00:00:01Z"), attachments: [] });
    renderChat([]);
    const user = userEvent.setup();
    const file = new File(["document"], "notes.txt", { type: "text/plain" });
    await user.upload(screen.getByLabelText("Attach files").parentElement!.querySelector('input[type="file"]')!, file);
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(api.postMessage).toHaveBeenCalledWith("c1", "", [file]));
  });

  it("adds dropped files to the pending message", async () => {
    vi.mocked(api.listMessages).mockResolvedValue([]);
    renderChat([]);
    const file = new File(["picture"], "dropped.png", { type: "image/png" });
    const chat = screen.getByRole("log").closest(".chat-view")!;
    fireEvent.dragEnter(chat, { dataTransfer: { types: ["Files"], files: [file] } });
    expect(screen.getByText("Drop files here")).toBeInTheDocument();
    fireEvent.drop(chat, { dataTransfer: { types: ["Files"], files: [file] } });
    expect(screen.queryByText("Drop files here")).not.toBeInTheDocument();
    expect(screen.getByText("dropped.png")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  it("adds an image pasted from the clipboard", () => {
    vi.mocked(api.listMessages).mockResolvedValue([]);
    renderChat([]);
    const image = new File(["clipboard-image"], "image.png", { type: "image/png" });
    const input = screen.getByLabelText("Message in général");
    fireEvent.paste(input, {
      clipboardData: {
        items: [{ kind: "file", getAsFile: () => image }],
      },
    });
    expect(screen.getByText("image.png")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  it("keeps normal text paste behavior when the clipboard has no file", async () => {
    vi.mocked(api.listMessages).mockResolvedValue([]);
    renderChat([]);
    const input = screen.getByLabelText("Message in général");
    await userEvent.setup().click(input);
    fireEvent.paste(input, { clipboardData: { items: [] } });
    expect(screen.queryByLabelText("Files to send")).not.toBeInTheDocument();
  });

  it("enforces the configured character limit in the composer", async () => {
    vi.mocked(api.listMessages).mockResolvedValue([]);
    render(
      <ToastProvider><ChatView channel={channel} maxMessageLength={100} messages={[]} onMessagesLoaded={vi.fn()} onMessagesPrepended={vi.fn()} /></ToastProvider>,
    );
    const input = screen.getByLabelText("Message in général");
    await userEvent.setup().type(input, "x".repeat(101));
    expect(input).toHaveValue("x".repeat(100));
    expect(screen.getByLabelText("100 of 100 characters")).toBeInTheDocument();
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
