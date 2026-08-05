import { useEffect, useState, type FormEvent, type UIEvent } from "react";
import type { Channel, Message } from "../api/client";
import * as api from "../api/client";
import { useToast } from "../toast/ToastContext";

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

  useEffect(() => {
    let cancelled = false;
    setHasMore(true);
    (async () => {
      try {
        const page = await api.listMessages(channel.id);
        if (cancelled) return;
        onMessagesLoaded([...page].reverse());
        setHasMore(page.length > 0);
      } catch {
        if (!cancelled) showToast("Impossible de charger les messages");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  async function loadMore() {
    if (loadingMore || !hasMore || messages.length === 0) return;
    setLoadingMore(true);
    try {
      const page = await api.listMessages(channel.id, { before: messages[0].createdAt });
      onMessagesPrepended([...page].reverse());
      setHasMore(page.length > 0);
    } catch {
      showToast("Impossible de charger l'historique");
    } finally {
      setLoadingMore(false);
    }
  }

  function handleScroll(e: UIEvent<HTMLDivElement>) {
    if (e.currentTarget.scrollTop < 40) void loadMore();
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
      <div className="chat-messages" role="log" aria-label="Historique des messages" onScroll={handleScroll}>
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
