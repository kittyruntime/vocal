import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { CurrentUser, SoundEvent, SoundSettings, SoundVolumes, UserSoundSettings } from "../api/client";
import { SOUND_EVENTS } from "../api/client";
import * as api from "../api/client";
import { configureSounds, previewSound } from "../audio/sounds";
import { Icon } from "../ui/Icon";

const MAX_AVATAR_BYTES = 512 * 1024;
const MAX_SOUND_BYTES = 5 * 1024 * 1024;
const SOUND_EVENT_LABEL: Record<SoundEvent, string> = {
  message: "Message received",
  userJoin: "Voice join",
  userLeave: "Voice leave",
  muteToggle: "Microphone mute/unmute",
  forceMuted: "Force-muted by a moderator",
  screenShare: "Screen sharing",
};
const DEFAULT_SOUND_SETTINGS: SoundSettings = Object.fromEntries(
  SOUND_EVENTS.map((event) => [event, { enabled: true, hasCustom: false }]),
) as SoundSettings;
const DEFAULT_SOUND_VOLUMES: SoundVolumes = Object.fromEntries(
  SOUND_EVENTS.map((event) => [event, 55]),
) as SoundVolumes;
const DEFAULT_USER_SOUND_SETTINGS: UserSoundSettings = Object.fromEntries(
  SOUND_EVENTS.map((event) => [event, { hasCustom: false }]),
) as UserSoundSettings;

export function ProfileModal({ currentUser, onClose, onSaved }: {
  currentUser: CurrentUser;
  onClose(): void;
  onSaved(): Promise<void>;
}) {
  const [username, setUsername] = useState(currentUser.username);
  const [email, setEmail] = useState(currentUser.email ?? "");
  const [description, setDescription] = useState(currentUser.description ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(currentUser.avatarUrl ?? null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(currentUser.bannerUrl ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const [soundSettings, setSoundSettings] = useState<SoundSettings>(DEFAULT_SOUND_SETTINGS);
  const [soundVolumes, setSoundVolumes] = useState<SoundVolumes>(DEFAULT_SOUND_VOLUMES);
  const [userSoundSettings, setUserSoundSettings] = useState<UserSoundSettings>(DEFAULT_USER_SOUND_SETTINGS);
  const soundInputRefs = useRef<Partial<Record<SoundEvent, HTMLInputElement | null>>>({});

  useEffect(() => {
    void Promise.all([api.getSoundSettings(), api.getMySoundVolumes(), api.getMySoundSettings()])
      .then(([nextSettings, nextVolumes, nextUserSettings]) => { setSoundSettings(nextSettings); setSoundVolumes(nextVolumes); setUserSoundSettings(nextUserSettings); })
      .catch(() => {});
  }, []);

  async function saveVolume(event: SoundEvent, volume: number) {
    setSoundVolumes((value) => ({ ...value, [event]: volume }));
    try {
      const freshVolumes = await api.updateMySoundVolume(event, volume);
      setSoundVolumes(freshVolumes);
      configureSounds(soundSettings, freshVolumes, userSoundSettings);
    } catch { /* keep the optimistic local value; a transient failure isn't worth surfacing here */ }
  }

  function uploadSound(event: SoundEvent, file: File) {
    if (!/^audio\/(mpeg|ogg|wav|webm)$/.test(file.type)) return setError("Choose an MP3, OGG, WAV or WebM audio file.");
    if (file.size > MAX_SOUND_BYTES) return setError("The sound file must be smaller than 5 MB.");
    const reader = new FileReader();
    reader.onload = () => {
      const audioData = typeof reader.result === "string" ? reader.result : null;
      if (!audioData) return;
      void api.updateMySoundSetting(event, audioData).then((setting) => {
        const next = { ...userSoundSettings, [event]: setting };
        setUserSoundSettings(next);
        configureSounds(soundSettings, soundVolumes, next);
        setError("");
      }).catch(() => setError("The personal sound could not be uploaded."));
    };
    reader.onerror = () => setError("The sound file could not be read.");
    reader.readAsDataURL(file);
  }

  async function resetSound(event: SoundEvent) {
    try {
      const setting = await api.updateMySoundSetting(event, null);
      const next = { ...userSoundSettings, [event]: setting };
      setUserSoundSettings(next);
      configureSounds(soundSettings, soundVolumes, next);
    } catch { setError("The personal sound could not be reset."); }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, saving]);

  async function selectAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
      setError("Choose a PNG, JPEG, WebP or GIF image.");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError("The profile picture must be smaller than 512 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAvatarUrl(typeof reader.result === "string" ? reader.result : null);
      setError("");
    };
    reader.onerror = () => setError("The image could not be read.");
    reader.readAsDataURL(file);
  }

  async function selectBanner(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return setError("Choose a PNG, JPEG, WebP or GIF banner.");
    if (file.size > MAX_AVATAR_BYTES) return setError("The profile banner must be smaller than 512 KB.");
    const reader = new FileReader();
    reader.onload = () => { setBannerUrl(typeof reader.result === "string" ? reader.result : null); setError(""); };
    reader.onerror = () => setError("The banner could not be read.");
    reader.readAsDataURL(file);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await api.updateProfile({ username: username.trim(), email: email.trim() || null, description: description.trim(), avatarUrl, bannerUrl });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The profile could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="voice-modal-backdrop profile-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <section className="voice-settings-modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <header>
          <div><span>USER SETTINGS</span><h2 id="profile-title">My profile</h2></div>
          <button type="button" className="modal-close" aria-label="Close profile settings" onClick={onClose} disabled={saving}><Icon name="close" size={18} /></button>
        </header>
        <form className="profile-form" onSubmit={submit}>
          <div className="profile-preview">
            <button type="button" className="profile-banner" style={bannerUrl ? { backgroundImage: `url(${bannerUrl})` } : undefined} onClick={() => bannerInputRef.current?.click()} aria-label="Change profile banner"><span><Icon name="camera" size={15} /> Change banner</span></button>
            <div className="profile-preview-body">
              <button type="button" className="profile-avatar-button" onClick={() => fileInputRef.current?.click()} aria-label="Change profile picture">
                {avatarUrl ? <img src={avatarUrl} alt="Profile preview" /> : <span>{username.slice(0, 1).toUpperCase() || "?"}</span>}
                <i><Icon name="camera" size={16} /></i>
              </button>
              <strong>{username || "Username"}</strong>
              <p>{description || "Add a short description about yourself."}</p>
            </div>
          </div>
          <input ref={fileInputRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => void selectAvatar(event)} />
          <input ref={bannerInputRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => void selectBanner(event)} />
          <div className="profile-fields">
            <label>Username<input value={username} onChange={(event) => setUsername(event.target.value)} minLength={2} maxLength={32} required /></label>
            <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} placeholder="you@example.com" /></label>
            <label className="profile-description">About me<textarea aria-label="About me" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={190} rows={4} placeholder="A few words about you…" /><small>{description.length}/190</small></label>
            <div className="profile-avatar-actions">
              <button type="button" onClick={() => fileInputRef.current?.click()}>Upload picture</button>
              {avatarUrl ? <button type="button" className="danger-link" onClick={() => setAvatarUrl(null)}>Remove</button> : null}
              <small>PNG, JPEG, WebP or GIF · 512 KB max</small>
            </div>
            <div className="profile-avatar-actions">
              <button type="button" onClick={() => bannerInputRef.current?.click()}>Upload banner</button>
              {bannerUrl ? <button type="button" className="danger-link" onClick={() => setBannerUrl(null)}>Remove banner</button> : null}
              <small>Recommended ratio 3:1 · 512 KB max</small>
            </div>
          </div>
          <div className="settings-section sound-volume-section">
            <h3>Notification sounds</h3>
            <p className="admin-setting-description">Choose your own sound and volume for every event. Server settings remain the fallback and control which sounds are enabled.</p>
            <div className="sound-volume-list">
              {SOUND_EVENTS.map((event) => (
                <div className="sound-volume-row" key={event}>
                  <div className="sound-volume-row-head"><span>{SOUND_EVENT_LABEL[event]}</span><small>{soundVolumes[event]}%</small></div>
                  <div className="sound-volume-row-controls">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      aria-label={`${SOUND_EVENT_LABEL[event]} volume`}
                      value={soundVolumes[event]}
                      onChange={(evt) => setSoundVolumes((value) => ({ ...value, [event]: Number(evt.target.value) }))}
                      onMouseUp={(evt) => void saveVolume(event, Number((evt.target as HTMLInputElement).value))}
                      onKeyUp={(evt) => void saveVolume(event, Number((evt.target as HTMLInputElement).value))}
                    />
                    <button type="button" aria-label={`Preview ${SOUND_EVENT_LABEL[event]}`} onClick={() => previewSound(event, soundSettings[event].hasCustom, soundVolumes[event], userSoundSettings[event].hasCustom)}><Icon name="volume" size={15} /></button>
                    <input aria-label={`${SOUND_EVENT_LABEL[event]} sound file`} ref={(element) => { soundInputRefs.current[event] = element; }} className="sr-only" type="file" accept="audio/mpeg,audio/ogg,audio/wav,audio/webm" onChange={(evt) => { const file = evt.target.files?.[0]; evt.target.value = ""; if (file) uploadSound(event, file); }} />
                    <button type="button" aria-label={`Upload ${SOUND_EVENT_LABEL[event]}`} onClick={() => soundInputRefs.current[event]?.click()}><Icon name="upload" size={15} /></button>
                    {userSoundSettings[event].hasCustom ? <button type="button" aria-label={`Reset ${SOUND_EVENT_LABEL[event]}`} onClick={() => void resetSound(event)}><Icon name="trash" size={15} /></button> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {error ? <p className="admin-error" role="alert">{error}</p> : null}
          <footer className="profile-actions">
            <button type="button" className="profile-cancel" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="profile-save" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
