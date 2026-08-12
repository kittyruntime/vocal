import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type UIEvent } from "react";
import type { Channel, CurrentUser, Message } from "../api/client";
import * as api from "../api/client";
import { useToast } from "../toast/ToastContext";
import { Icon } from "../ui/Icon";
import { TextField } from "../ui/form";

const PAGE_SIZE = 50;
// Mirrors the server's inline-safe allowlist (server/src/routes/messages.ts)
// so an SVG attachment -- which the server always forces as a download,
// since inline SVG can carry executable script -- doesn't render as a
// (broken) inline image here; it shows as a regular file download instead.
const INLINE_SAFE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);
const EMOTES = [
  "😀", "😂", "🥹", "😍", "🥰", "😎", "🤔", "🫡",
  "😭", "😤", "😡", "🤯", "🥳", "😴", "👀", "💀",
  "👍", "👎", "👏", "🙌", "🙏", "🤝", "💪", "🫶",
  "❤️", "💙", "💜", "🔥", "✨", "🎉", "✅", "🚀",
];

// How close to the bottom (in px) the user has to be scrolled for a newly-arrived message to
// auto-scroll the view. Keeps someone who scrolled up to read history from being yanked down.
const NEAR_BOTTOM_THRESHOLD_PX = 100;

// Caps how many messages stay loaded (and rendered) at once, so an active
// channel with years of history can't grow this list -- and its DOM node
// count -- without bound over a single long session. Deliberately NOT true
// virtualization (windowed rendering): this codebase's test environment
// (jsdom) has no layout engine, ResizeObserver, or Element.scrollTo, so a
// virtualized list's actual scroll behavior couldn't be verified by an
// automated test here. This cap is a real, fully-tested bound on growth
// instead. See ROADMAP.md for the full reasoning.
const MAX_LOADED_MESSAGES = 300;

export function ChatView({
  channel,
  maxMessageLength = 4000,
  messages,
  onMessagesLoaded,
  onMessagesPrepended,
  onOpenSidebar,
  onViewProfile,
  currentUser,
  typingUsernames = [],
  onTypingChange,
  notificationLevel = "all",
  onNotificationLevelChange,
}: {
  channel: Channel;
  maxMessageLength?: number;
  messages: Message[];
  onMessagesLoaded(messages: Message[]): void;
  onMessagesPrepended(messages: Message[]): void;
  onOpenSidebar?(): void;
  onViewProfile?(userId: string): void;
  currentUser?: CurrentUser;
  typingUsernames?: string[];
  onTypingChange?(active: boolean): void;
  notificationLevel?: "all" | "mentions" | "none";
  onNotificationLevelChange?(level: "all" | "mentions" | "none"): void;
}) {
  const { showToast } = useToast();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [emotesOpen, setEmotesOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const messagesRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emotesRef = useRef<HTMLDivElement>(null);
  const dragDepthRef = useRef(0);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  useEffect(() => () => {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    onTypingChange?.(false);
  }, [channel.id, onTypingChange]);

  function updateDraft(value: string) {
    setDraft(value);
    onTypingChange?.(value.length > 0);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => onTypingChange?.(false), 1800);
  }

  useEffect(() => {
    if (!emotesOpen) return;
    function closeEmotes(event: MouseEvent) {
      if (!emotesRef.current?.contains(event.target as Node)) setEmotesOpen(false);
    }
    function closeEmotesWithKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setEmotesOpen(false);
        composerInputRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", closeEmotes);
    document.addEventListener("keydown", closeEmotesWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeEmotes);
      document.removeEventListener("keydown", closeEmotesWithKeyboard);
    };
  }, [emotesOpen]);

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

  // Trims the oldest loaded messages once the total exceeds MAX_LOADED_MESSAGES,
  // but only while the user is near the bottom (i.e. not actively reading the
  // history that would be trimmed) -- otherwise this would yank content out
  // from under someone scrolled up into old messages. In practice this only
  // fires once the live WebSocket feed has appended enough new messages to
  // push the total over the cap while the user is following along at the
  // bottom; loadMore's own cap check (below) handles the other growth path
  // (repeatedly scrolling up to load older history) without ever evicting
  // anything the user might currently be looking at.
  useEffect(() => {
    if (messages.length <= MAX_LOADED_MESSAGES || !isNearBottomRef.current) return;
    onMessagesLoaded(messages.slice(messages.length - MAX_LOADED_MESSAGES));
  }, [messages, onMessagesLoaded]);

  async function loadMore() {
    if (loadingMore || !hasMore || messages.length === 0) return;
    if (messages.length >= MAX_LOADED_MESSAGES) {
      setHasMore(false);
      return;
    }
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

  function addFiles(values: File[]) {
    if (values.length === 0) return;
    setFiles((current) => [...current, ...values].slice(0, 10));
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    addFiles([...event.dataTransfer.files]);
    requestAnimationFrame(() => composerInputRef.current?.focus());
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const pastedFiles = [...event.clipboardData.items]
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (pastedFiles.length === 0) return;
    event.preventDefault();
    addFiles(pastedFiles);
    requestAnimationFrame(() => composerInputRef.current?.focus());
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if ((!content && files.length === 0) || sending) return;
    setSending(true);
    try {
      await (replyTo
        ? api.postMessage(channel.id, content, files, replyTo.id)
        : files.length > 0
          ? api.postMessage(channel.id, content, files)
          : api.postMessage(channel.id, content));
      setDraft("");
      setFiles([]);
      setReplyTo(null);
      onTypingChange?.(false);
    } catch {
      showToast("The message could not be sent");
    } finally {
      setSending(false);
      composerInputRef.current?.focus();
    }
  }

  async function saveEdit(messageId: string) {
    const content = editDraft.trim();
    if (!content) return;
    try {
      await api.updateMessage(channel.id, messageId, content);
      setEditingId(null);
    } catch { showToast("The message could not be edited"); }
  }

  async function removeMessage(message: Message) {
    if (!window.confirm("Delete this message?")) return;
    try { await api.deleteMessage(channel.id, message.id); }
    catch { showToast("The message could not be deleted"); }
  }

  async function toggleReaction(message: Message, emoji: string) {
    try {
      const active = message.reactions?.find((reaction) => reaction.emoji === emoji)?.userIds.includes(currentUser?.id ?? "") ?? false;
      await (active ? api.removeMessageReaction(channel.id, message.id, emoji) : api.addMessageReaction(channel.id, message.id, emoji));
    } catch { showToast("The reaction could not be updated"); }
  }

  function insertEmote(emote: string) {
    const input = composerInputRef.current;
    const start = input?.selectionStart ?? draft.length;
    const end = input?.selectionEnd ?? start;
    const nextDraft = `${draft.slice(0, start)}${emote}${draft.slice(end)}`.slice(0, maxMessageLength);
    setDraft(nextDraft);
    setEmotesOpen(false);
    requestAnimationFrame(() => {
      input?.focus();
      const cursor = Math.min(start + emote.length, nextDraft.length);
      input?.setSelectionRange(cursor, cursor);
    });
  }

  return (
    <div className={`chat-view ${dragActive ? "is-dragging-files" : ""}`} onPaste={handlePaste} onDragEnter={handleDragEnter} onDragOver={(event) => {
      if (event.dataTransfer.types.includes("Files")) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }
    }} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {dragActive ? <div className="chat-drop-overlay" role="status"><div><Icon name="upload" size={34} /><strong>Drop files here</strong><span>They will be added to your message</span></div></div> : null}
      <header className="chat-header">
        <button type="button" className="mobile-menu-button" aria-label="Open channel list" onClick={() => onOpenSidebar?.()}>
          <Icon name="menu" size={20} />
        </button>
        <span className="header-channel-icon"><Icon name="hash" size={22} /></span> {channel.name}
        <button type="button" className="chat-notification-button" aria-label={`Notifications: ${notificationLevel}`} title={`Notifications: ${notificationLevel}`} onClick={() => onNotificationLevelChange?.(notificationLevel === "all" ? "mentions" : notificationLevel === "mentions" ? "none" : "all")}><Icon name={notificationLevel === "all" ? "bellRing" : notificationLevel === "mentions" ? "bell" : "bellOff"} size={18} /></button>
      </header>
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
            <button type="button" className="message-profile-trigger" aria-label={`View profile of ${message.username}`} onClick={() => onViewProfile?.(message.userId)}><span className="message-avatar" aria-hidden="true">{message.avatarUrl ? <img src={message.avatarUrl} alt="" /> : message.username.slice(0, 1).toUpperCase()}</span></button>
            <div className="message-body">
              {message.replyTo ? <div className="message-reply-context"><Icon name="reply" size={13} /><strong>{message.replyTo.username}</strong><span>{message.replyTo.content || "Attachment"}</span></div> : null}
              <div className="message-meta">
                <button type="button" className="chat-author" onClick={() => onViewProfile?.(message.userId)}>{message.username}</button>
                <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>{message.editedAt ? <span className="message-edited">(edited)</span> : null}
              </div>
              {editingId === message.id ? <form className="message-edit-form" onSubmit={(event) => { event.preventDefault(); void saveEdit(message.id); }}><TextField label="Edit message" visuallyHiddenLabel value={editDraft} maxLength={maxMessageLength} autoFocus onChange={(event) => setEditDraft(event.target.value)} /><div><button type="button" onClick={() => setEditingId(null)}>Cancel</button><button type="submit">Save</button></div></form> : <MessageContent content={message.content} />}
              {(message.attachments?.length ?? 0) > 0 ? <div className="message-attachments">
                {message.attachments!.map((attachment) => INLINE_SAFE_MIME_TYPES.has(attachment.mimeType) ? (
                  <a key={attachment.id} className="message-image" href={attachment.url} target="_blank" rel="noreferrer">
                    <img src={attachment.url} alt={attachment.filename} loading="lazy" />
                  </a>
                ) : (
                  <a key={attachment.id} className="message-file" href={attachment.url} download={attachment.filename}>
                    <span><Icon name="file" size={22} /></span>
                    <span><strong>{attachment.filename}</strong><small>{formatFileSize(attachment.size)}</small></span>
                  </a>
                ))}
              </div> : null}
              {(message.reactions?.length ?? 0) > 0 ? <div className="message-reactions">{message.reactions!.map((reaction) => <button type="button" key={reaction.emoji} className={reaction.userIds.includes(currentUser?.id ?? "") ? "active" : ""} aria-label={`${reaction.emoji}, ${reaction.count} reactions`} onClick={() => void toggleReaction(message, reaction.emoji)}><span>{reaction.emoji}</span>{reaction.count}</button>)}</div> : null}
            </div>
            <div className="message-actions" aria-label="Message actions"><button type="button" aria-label="Reply" onClick={() => { setReplyTo(message); composerInputRef.current?.focus(); }}><Icon name="reply" size={16} /></button>{["👍", "❤️", "😂"].map((emoji) => <button type="button" key={emoji} aria-label={`React ${emoji}`} onClick={() => void toggleReaction(message, emoji)}>{emoji}</button>)}{message.userId === currentUser?.id ? <button type="button" aria-label="Edit message" onClick={() => { setEditingId(message.id); setEditDraft(message.content); }}><Icon name="edit" size={15} /></button> : null}{message.userId === currentUser?.id || currentUser?.capabilities.includes("moderate") ? <button type="button" className="danger" aria-label="Delete message" onClick={() => void removeMessage(message)}><Icon name="trash" size={15} /></button> : null}</div>
          </article>
        ))}
      </div>
      {files.length > 0 ? <div className="composer-attachments" aria-label="Files to send">
        {files.map((file, index) => <PendingFile key={`${file.name}-${file.lastModified}-${index}`} file={file} onRemove={() => setFiles((values) => values.filter((_, valueIndex) => valueIndex !== index))} />)}
      </div> : null}
      {replyTo ? <div className="composer-reply"><span>Replying to <strong>{replyTo.username}</strong></span><button type="button" aria-label="Cancel reply" onClick={() => setReplyTo(null)}><Icon name="close" size={15} /></button></div> : null}
      <form className="chat-composer" onSubmit={handleSubmit}>
        <div className="composer-field">
          <button type="button" className="composer-attach-button" aria-label="Attach files" onClick={() => fileInputRef.current?.click()}><Icon name="plus" size={20} /></button>
          <input ref={fileInputRef} className="sr-only" type="file" multiple onChange={(event) => {
            const selected = [...(event.target.files ?? [])];
            addFiles(selected);
            event.target.value = "";
          }} />
          <TextField
            ref={composerInputRef}
            label={`Message in ${channel.name}`}
            visuallyHiddenLabel
            placeholder={`Send a message in #${channel.name}`}
            value={draft}
            maxLength={maxMessageLength}
            onChange={(e) => updateDraft(e.target.value)}
          />
          {draft.length >= maxMessageLength * .8 ? <span className="composer-count" aria-label={`${draft.length} of ${maxMessageLength} characters`}>{draft.length}/{maxMessageLength}</span> : null}
          <div className="composer-emotes" ref={emotesRef}>
            <button type="button" className={`composer-emote-button ${emotesOpen ? "active" : ""}`} aria-label="Choose an emote" aria-expanded={emotesOpen} onClick={() => setEmotesOpen((open) => !open)}><Icon name="smile" size={21} /></button>
            {emotesOpen ? <div className="emote-picker" role="dialog" aria-label="Emotes">
              <strong>Emotes</strong>
              <div className="emote-grid">{EMOTES.map((emote) => <button type="button" key={emote} aria-label={`Insert ${emote}`} onClick={() => insertEmote(emote)}>{emote}</button>)}</div>
            </div> : null}
          </div>
        </div>
        <button type="submit" aria-label="Send" disabled={sending || (draft.trim().length === 0 && files.length === 0)}>
          <Icon name="send" size={18} /><span className="sr-only">Send</span>
        </button>
      </form>
      <div className="typing-indicator" aria-live="polite">{formatTypingUsers(typingUsernames)}</div>
    </div>
  );
}

function MessageContent({ content }: { content: string }) {
  const parts = content.split(/(@everyone|@[\p{L}\p{N}_.-]+)/gu);
  return <div className="chat-content">{parts.map((part, index) => part.startsWith("@") ? <mark className="message-mention" key={index}>{part}</mark> : part)}</div>;
}

function formatTypingUsers(usernames: string[]): string {
  if (usernames.length === 0) return "";
  if (usernames.length === 1) return `${usernames[0]} is typing…`;
  if (usernames.length === 2) return `${usernames[0]} and ${usernames[1]} are typing…`;
  return `${usernames.length} people are typing…`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function PendingFile({ file, onRemove }: { file: File; onRemove(): void }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith("image/") || typeof URL.createObjectURL !== "function") return;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return <div>
    {previewUrl ? <img src={previewUrl} alt="" /> : <Icon name="file" size={18} />}
    <span title={file.name}>{file.name}</span>
    <button type="button" aria-label={`Remove ${file.name}`} onClick={onRemove}><Icon name="close" size={14} /></button>
  </div>;
}

function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(date);
}
