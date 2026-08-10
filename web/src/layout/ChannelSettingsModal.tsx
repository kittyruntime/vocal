import { useState } from "react";
import type { Capability, Channel } from "../api/client";
import * as api from "../api/client";
import { Icon } from "../ui/Icon";

const CAPABILITY_LABEL: Record<Capability, string> = {
  manage_channels: "Channel managers only",
  manage_server: "Server managers only",
  moderate: "Moderators only",
  publish_voice: "Voice members only",
};

const CAPABILITY_HELP: Record<Capability, string> = {
  manage_channels: "Only members allowed to create and configure channels will see it.",
  manage_server: "Only members with full server-management access will see it.",
  moderate: "Only members with moderation permission will see it.",
  publish_voice: "Only members allowed to publish audio and video will see it.",
};

export function ChannelSettingsModal({ channel, onUpdated, onDeleted, onClose }: {
  channel: Channel;
  onUpdated(channel: Channel): void;
  onDeleted(channelId: string): void;
  onClose(): void;
}) {
  const [draft, setDraft] = useState(channel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    try {
      const value = await api.updateChannel(channel.id, draft);
      onUpdated(value);
      onClose();
    } catch {
      setError("Could not save this channel.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete the channel "${channel.name}"?`)) return;
    setBusy(true);
    setError("");
    try {
      await api.deleteChannel(channel.id);
      onDeleted(channel.id);
      onClose();
    } catch {
      setError("Could not delete this channel.");
      setBusy(false);
    }
  }

  return (
    <div
      className="voice-modal-backdrop channel-settings-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="voice-settings-modal channel-settings-modal" role="dialog" aria-modal="true" aria-labelledby="channel-settings-title">
        <header>
          <div>
            <span>{channel.type === "text" ? "TEXT CHANNEL" : "VOICE CHANNEL"}</span>
            <h2 id="channel-settings-title">Settings for {channel.type === "text" ? "#" : ""}{channel.name}</h2>
          </div>
          <button type="button" className="modal-close" aria-label="Close channel settings" autoFocus onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        </header>
        <div className="voice-settings-content">
          {error ? <p className="admin-error" role="alert">{error}</p> : null}
          <div className="settings-section">
            <h3>Overview</h3>
            <div className="channel-overview-fields">
              <label>
                Channel name
                <div className="channel-name-field"><span aria-hidden="true">{channel.type === "text" ? "#" : "◖))"}</span><input aria-label={`Name of ${channel.name}`} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
              </label>
              <label>
                Who can access this channel?
                <select
                  aria-label={`Access to ${channel.name}`}
                  value={draft.requiredCapability ?? ""}
                  onChange={(event) => setDraft({ ...draft, requiredCapability: (event.target.value || null) as Capability | null })}
                >
                  <option value="">Everyone</option>
                  {(Object.keys(CAPABILITY_LABEL) as Capability[]).map((capability) => (
                    <option key={capability} value={capability}>{CAPABILITY_LABEL[capability]}</option>
                  ))}
                </select>
              </label>
              <p className="channel-access-help">
                {draft.requiredCapability ? CAPABILITY_HELP[draft.requiredCapability] : "Every server member can see and open this channel."}
              </p>
            </div>
          </div>
          {channel.type === "voice" ? (
            <div className="settings-section">
              <h3>Default media quality</h3>
              <div className="admin-quality-row">
                <Quality label="Audio" value={draft.defaultAudioQuality ?? "standard"} onChange={(value) => setDraft({ ...draft, defaultAudioQuality: value as Channel["defaultAudioQuality"] })} />
                <Quality label="Webcam" value={draft.defaultCameraQuality ?? "standard"} onChange={(value) => setDraft({ ...draft, defaultCameraQuality: value as Channel["defaultCameraQuality"] })} />
                <Quality label="Screen share" game value={draft.defaultScreenQuality ?? "standard"} onChange={(value) => setDraft({ ...draft, defaultScreenQuality: value as Channel["defaultScreenQuality"] })} />
              </div>
            </div>
          ) : null}
          <div className="settings-section channel-danger-zone">
            <div><h3>Delete channel</h3><p>This permanently deletes the channel{channel.type === "text" ? " and its message history" : ""}.</p></div>
            <button type="button" className="danger-link" disabled={busy} onClick={() => void remove()}>Delete channel</button>
          </div>
          <div className="admin-channel-actions channel-settings-actions">
            <button type="button" className="profile-cancel" disabled={busy} onClick={onClose}>Cancel</button>
            <button type="button" disabled={busy || !draft.name.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Save changes"}</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function Quality({ label, value, game, onChange }: { label: string; value: string; game?: boolean; onChange(value: string): void }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="low">Data saver</option>
        <option value="standard">Balanced</option>
        <option value="high">High</option>
        {game ? <option value="game">Game mode 1080p60</option> : null}
      </select>
    </label>
  );
}
