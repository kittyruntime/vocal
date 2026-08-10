import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type UIEvent } from "react";
import type { Channel, Message } from "../api/client";
import * as api from "../api/client";
import { useToast } from "../toast/ToastContext";
import { Icon } from "../ui/Icon";

const PAGE_SIZE = 50;

// How close to the bottom (in px) the user has to be scrolled for a newly-arrived message to
// auto-scroll the view. Keeps someone who scrolled up to read history from being yanked down.
const NEAR_BOTTOM_THRESHOLD_PX = 100;

export function ChatView({
  channel,
  messages,
  onMessagesLoaded,
  onMessagesPrepended,
}: {
  channel: Channel;
  messages: Message[];
  onMessagesLoaded(messages: Message[]): void;
  onMessagesPrepended(messages: Message[]): void;
}) {
  const { showToast } = useToast();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const messagesRef = useRef<HTMLDivElement>(null);
  // Tells the scroll-restoration effect (below) why `messages` just changed, so it knows
  // whether to jump to the bottom, preserve the reading position, or leave things alone.
  const pendingScrollActionRef = useRef<"load" | "prepend" | null>(null);
  const prependMetricsRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const isNearBottomRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    setHasMore(true);
    pendingScrollActionRef.current = "load";
    (async () => {
      try {
        const page = await api.listMessages(channel.id, { limit: PAGE_SIZE });
        if (cancelled) return;
        onMessagesLoaded([...page].reverse());
        setHasMore(page.length >= PAGE_SIZE);
      } catch {
        if (!cancelled) showToast("Could not load messages");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  // Restore/adjust the scroll position whenever the rendered message list changes, based on
  // why it changed (see pendingScrollActionRef above).
  useLayoutEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const action = pendingScrollActionRef.current;
    pendingScrollActionRef.current = null;

    if (action === "load") {
      el.scrollTop = el.scrollHeight;
    } else if (action === "prepend") {
      const before = prependMetricsRef.current;
      prependMetricsRef.current = null;
      if (before) {
        el.scrollTop = el.scrollHeight - before.scrollHeight + before.scrollTop;
      }
    } else if (isNearBottomRef.current) {
      // A message was appended some other way (e.g. a live WebSocket event) -- only follow
      // it to the bottom if the user was already reading the bottom of the channel.
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  async function loadMore() {
    if (loadingMore || !hasMore || messages.length === 0) return;
    setLoadingMore(true);
    const el = messagesRef.current;
    if (el) {
      prependMetricsRef.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
    }
    pendingScrollActionRef.current = "prepend";
    try {
      const page = await api.listMessages(channel.id, { before: messages[0].createdAt, limit: PAGE_SIZE });
      onMessagesPrepended([...page].reverse());
      setHasMore(page.length >= PAGE_SIZE);
    } catch {
      pendingScrollActionRef.current = null;
      prependMetricsRef.current = null;
      showToast("Could not load history");
    } finally {
      setLoadingMore(false);
    }
  }

  function handleScroll(e: UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD_PX;
    if (el.scrollTop < 40) void loadMore();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setSending(true);
    try {
      await api.postMessage(channel.id, content);
      setDraft("");
    } catch {
      showToast("The message could not be sent");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat-view">
      <header className="chat-header"><span className="header-channel-icon"><Icon name="hash" size={22} /></span> {channel.name}</header>
      <div
        className="chat-messages"
        role="log"
        aria-label="Message history"
        onScroll={handleScroll}
        ref={messagesRef}
      >
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-icon"><Icon name="hash" size={38} /></div>
            <h1>Welcome to #{channel.name}</h1>
            <p>This is the beginning of this channel.</p>
          </div>
        )}
        {messages.map((message) => (
          <article key={message.id} className="chat-message">
            <span className="message-avatar" aria-hidden="true">{message.username.slice(0, 1).toUpperCase()}</span>
            <div className="message-body">
              <div className="message-meta">
                <span className="chat-author">{message.username}</span>
                <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
              </div>
              <div className="chat-content">{message.content}</div>
            </div>
          </article>
        ))}
      </div>
      <form className="chat-composer" onSubmit={handleSubmit}>
        <div className="composer-field">
          <span aria-hidden="true"><Icon name="plus" size={20} /></span>
          <input
            aria-label={`Message in ${channel.name}`}
            placeholder={`Send a message in #${channel.name}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={sending}
          />
        </div>
        <button type="submit" aria-label="Send" disabled={sending || draft.trim().length === 0}>
          <Icon name="send" size={18} /><span className="sr-only">Send</span>
        </button>
      </form>
    </div>
  );
}

function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(date);
}
