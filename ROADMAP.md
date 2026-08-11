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
- [ ] Call network diagnostics and automatic quality adaptation — **in progress**
- [ ] Server-side member pagination, long-list virtualization and LiveKit bundle optimization
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

## Handoff for Claude

Branch state: `main` is clean and synchronized with `origin/main` at `48404c9`.

Last verified test baseline:

- server: 14 files, 99 tests passing;
- web: 18 files, 127 tests passing;
- server and web TypeScript checks passing;
- production web build passing (the existing LiveKit chunk-size warning remains).

Next lot: **call network diagnostics and automatic quality adaptation**. No code for this lot has been written yet. The relevant implementation is concentrated in `web/src/voice/VoiceView.tsx`.

Useful LiveKit 2.21 APIs already confirmed in the installed dependency:

- `RoomEvent.ConnectionQualityChanged` reports `ConnectionQuality` plus the participant;
- `RemoteTrackPublication.setVideoQuality(VideoQuality)` can lower or restore subscribed remote video quality;
- remote audio/video tracks expose receiver stats internally through `getStats()` implementations;
- local tracks expose sender statistics;
- the room already uses `adaptiveStream: true` and `dynacast: true`.

Suggested implementation:

1. Track local connection quality and show a compact Good/Poor/Lost badge in the voice header.
2. Sample WebRTC candidate-pair and inbound RTP stats every 2–3 seconds while connected; display RTT and packet loss only when the browser exposes them.
3. When quality becomes poor, call `setVideoQuality(VideoQuality.LOW)` on remote video publications; restore `HIGH` after several consecutive good samples to avoid oscillation.
4. Clear timers and metrics through the existing `resetCallState()`/room cleanup paths.
5. Add focused `VoiceView` tests for the quality event and automatic downgrade before committing this lot.

Remaining lots after network diagnostics:

1. Server-side member pagination, long-list/message virtualization, and further LiveKit code splitting.
2. Full integration pass: responsive behavior, migrations on an existing database, complete tests/build, and deployment documentation verification.
