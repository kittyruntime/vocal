# Vocal roadmap

Last updated: 2026-08-11

This file is the hand-off point for the current product pass. Update it after every stable, pushed lot.

## Status

- [x] Frontend visual system, member settings navigation and client-side member pagination
- [x] Message interactions: replies, reactions, edit and delete
- [x] Typing presence, mentions and notification preferences
- [x] Named roles with colors and reusable permissions
- [x] Global search across messages, attachments, channels and members
- [x] Configurable, revocable invitation links
- [x] Voice layouts: pinning, speaker/grid modes, hidden audio-only participants and ordering
- [x] Call network diagnostics and automatic quality adaptation
- [ ] Server-side member pagination, long-list virtualization and LiveKit bundle optimization — **next**
- [ ] Final integration, responsive and deployment verification

## Delivery notes

- Each checked item must have server and web tests where applicable.
- Database changes use additive numbered migrations and remain compatible with existing deployments.
- Each stable lot is committed and pushed separately to `main`.

## Delivered lots

- `message-interactions`: encrypted reply previews, realtime reaction aggregation, author editing, author/moderator deletion, Discord-style message toolbar and inline editing.
- `notifications`: realtime typing presence, highlighted mentions, unread counters, mention badges and per-channel all/mentions/muted preferences.
- `roles`: additive named roles with colors, reusable capabilities, multi-role member assignment and backwards-compatible effective permissions.
- `search`: permission-aware global search for encrypted messages, attachment names, channels and members, with a responsive command-style modal.
- `invites`: configurable expiry and use limits, active-link inventory, copy flow, revocation and concurrency-safe consumption.
- `voice-layouts`: grid/focus modes, click-to-pin media, screen/speaker ordering and an optional audio-only participant strip.
- `network-diagnostics`: local `ConnectionQuality` tracked via `RoomEvent.ConnectionQualityChanged` and shown as a compact Good/Poor/Lost badge in the voice header (tooltip shows RTT/packet-loss when the browser exposes `remote-inbound-rtp`/`candidate-pair` stats, sampled every 2.5s via `getRTCStatsReport()`); remote video is auto-downgraded to `VideoQuality.LOW` on poor/lost quality and restored to `HIGH` only after 3 consecutive good samples (hysteresis, avoids thrashing), including for tracks subscribed while already downgraded. Also removed automatic voice-channel joining (explicit user request): selecting a voice channel — including switching directly from one voice channel to another while already connected — never auto-connects anymore; it only leaves the previous channel cleanly and always requires an explicit "Join" click. The old `autoJoinedChannelRef` auto-join effect was deleted rather than disabled.

## Handoff for Claude

Branch state: `main` is clean and synchronized with `origin/main` at `28ea740`.

Last verified test baseline:

- server: 14 files, 99 tests passing;
- web: 18 files, 132 tests passing;
- server and web TypeScript checks passing;
- production web build passing (the existing LiveKit chunk-size warning remains).

Next lot: **server-side member pagination, long-list virtualization and LiveKit bundle optimization**. No code for this lot has been written yet.

Known context for the next lot:

- Member/user lists (admin panel, search results, mention autocomplete, etc.) are currently paginated client-side only — worth auditing which server routes return unbounded lists today before adding server-side pagination.
- Long lists most likely to need virtualization: the admin member list and the chat message list (`web/src/layout/ChatView.tsx` or wherever it now lives) once channels have real message history.
- `VoiceView` is lazy-loaded already (see the `dist/assets/VoiceView-*.js` chunk in the build output) but is the single largest chunk (~517 kB / ~134 kB gzip) — look at splitting `livekit-client` itself or code-splitting the settings modal / layout-mode UI out of the main chunk.

Remaining lots after that:

1. Full integration pass: responsive behavior, migrations on an existing database, complete tests/build, and deployment documentation verification.
