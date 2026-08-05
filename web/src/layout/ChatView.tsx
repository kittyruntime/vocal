import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type UIEvent } from "react";
import type { Channel, Message } from "../api/client";
import * as api from "../api/client";
import { useToast } from "../toast/ToastContext";

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
        if (!cancelled) showToast("Impossible de charger les messages");
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
      showToast("Impossible de charger l'historique");
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
      showToast("Le message n'a pas pu être envoyé");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat-view">
      <header className="chat-header"># {channel.name}</header>
      <div
        className="chat-messages"
        role="log"
        aria-label="Historique des messages"
        onScroll={handleScroll}
        ref={messagesRef}
      >
        {messages.map((message) => (
          <div key={message.id} className="chat-message">
            <span className="chat-author">{message.username}</span>
            <span className="chat-content">{message.content}</span>
          </div>
        ))}
      </div>
      <form className="chat-composer" onSubmit={handleSubmit}>
        <input
          aria-label={`Message dans ${channel.name}`}
          placeholder={`Écrire dans #${channel.name}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={sending}
        />
        <button type="submit" disabled={sending || draft.trim().length === 0}>
          Envoyer
        </button>
      </form>
    </div>
  );
}
