import { useEffect, useRef, useState } from "react";
import type { SearchResults } from "../api/client";
import * as api from "../api/client";
import { Icon } from "../ui/Icon";

const EMPTY: SearchResults = { channels: [], members: [], messages: [] };

export function SearchModal({ onClose, onSelectChannel, onViewProfile }: { onClose(): void; onSelectChannel(channelId: string): void; onViewProfile(userId: string): void }) {
  const [query, setQuery] = useState(""); const [results, setResults] = useState(EMPTY); const [loading, setLoading] = useState(false); const requestRef = useRef(0);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [onClose]);
  useEffect(() => {
    if (query.trim().length < 2) { setResults(EMPTY); setLoading(false); return; }
    const request = ++requestRef.current; setLoading(true);
    const timer = setTimeout(() => void api.search(query.trim()).then((value) => { if (request === requestRef.current) setResults(value); }).catch(() => { if (request === requestRef.current) setResults(EMPTY); }).finally(() => { if (request === requestRef.current) setLoading(false); }), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const empty = !loading && query.trim().length >= 2 && results.channels.length + results.members.length + results.messages.length === 0;
  return <div className="voice-modal-backdrop search-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="search-modal" role="dialog" aria-modal="true" aria-label="Search"><div className="search-input"><Icon name="search" size={20} /><input aria-label="Search Vocal" autoFocus placeholder="Search messages, files, channels and members" value={query} onChange={(event) => setQuery(event.target.value)} /><button type="button" aria-label="Close search" onClick={onClose}><Icon name="close" size={18} /></button></div><div className="search-results">{loading ? <p className="search-status">Searching…</p> : null}{results.channels.length > 0 ? <section><h2>Channels</h2>{results.channels.map((channel) => <button type="button" key={channel.id} onClick={() => { onSelectChannel(channel.id); onClose(); }}><Icon name={channel.type === "voice" ? "volume" : "hash"} size={17} /><span>{channel.name}</span></button>)}</section> : null}{results.members.length > 0 ? <section><h2>Members</h2>{results.members.map((member) => <button type="button" key={member.id} onClick={() => { onViewProfile(member.id); onClose(); }}><span className="member-avatar">{member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : member.username[0].toUpperCase()}</span><span>{member.username}</span></button>)}</section> : null}{results.messages.length > 0 ? <section><h2>Messages and files</h2>{results.messages.map((message) => <button type="button" className="search-message-result" key={message.id} onClick={() => { onSelectChannel(message.channelId); onClose(); }}><Icon name="hash" size={16} /><span><strong>{message.username} in #{message.channelName}</strong><small>{message.content || message.filenames.join(", ")}</small></span></button>)}</section> : null}{empty ? <p className="search-status">No results for “{query.trim()}”.</p> : null}{query.trim().length < 2 ? <p className="search-status">Type at least two characters to search.</p> : null}</div></section></div>;
}
