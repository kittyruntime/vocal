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
- [x] Server-side member pagination
- [ ] Long-list virtualization and LiveKit bundle optimization — **next, deferred once already (see notes below)**
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
- `admin-pagination`: `GET /api/admin/users` now takes `?search=&page=&limit=` and returns `{users, total}` instead of every user unbounded; `AdminPanel.tsx` fetches the current page from the server (search box debounced 250ms) instead of loading everyone and slicing/filtering client-side.

## Security fixes

- SVG attachments were served with `Content-Disposition: inline` (any client-supplied `image/*` MIME type was trusted), and the web client linked directly to that URL for anything it treated as an image -- a stored XSS, since SVG can carry `<script>`/event handlers that execute when opened as a top-level document. Fixed by restricting inline rendering to an explicit raster-image allowlist (`server/src/routes/messages.ts`'s `INLINE_SAFE_MIME_TYPES`, mirrored client-side in `web/src/layout/ChatView.tsx`); anything outside it, including SVG, is always forced to download, plus `X-Content-Type-Options: nosniff` and a restrictive CSP on that response. **Do not widen that allowlist back to a bare `startsWith("image/")` check.**

## Handoff for Claude

Branch state: `main` is clean and synchronized with `origin/main` at `9aaaccf`.

Last verified test baseline:

- server: 14 files, 101 tests passing;
- web: 18 files, 134 tests passing;
- server and web TypeScript checks passing;
- production web build passing (the existing LiveKit chunk-size warning remains).

Next lot: **long-list virtualization (chat messages) and LiveKit bundle deferral**. Deliberately deferred once already this pass -- both were scoped and rejected in favor of the smaller, safer admin-pagination lot that *did* ship. Reasoning, so the next attempt doesn't have to redo this analysis:

- **Chat message virtualization**: `ChatView.tsx`'s message list has real custom scroll-restoration logic (`pendingScrollActionRef`, `prependMetricsRef`, `isNearBottomRef`) built around direct DOM measurement (`scrollHeight`/`scrollTop`) of a normal, fully-rendered list. No virtualization library is installed (`react-window` v2 is available on the registry and has a very different, simpler API than v1 -- confirm the current API before using it, don't assume v1 patterns from memory). Swapping in windowed rendering means rebuilding that scroll-restoration logic against the library's own positioning/imperative-scroll API, and this cannot be visually verified in this environment (no real browser) -- jsdom + Testing Library can check DOM structure and state but not real scrollbar/measurement behavior. Treat this as its own dedicated pass: write it, then have the user (or a real E2E run) actually scroll a long channel before trusting it, rather than shipping on unit-test confidence alone.
- **LiveKit bundle**: `VoiceView` is already lazy-loaded (only downloaded once a voice channel is selected), which is the optimization that actually matters for initial page load. The remaining ~517 kB / ~134 kB gzip is overwhelmingly `livekit-client` itself, imported statically at the top of `VoiceView.tsx` and used as *values* (not just types) throughout the file -- `Room`, `RoomEvent.*`, `Track.*`, `ConnectionQuality.*`, `VideoQuality.*`, `MediaDeviceFailure`, `ConnectionError` -- including in module-level helper functions (`describeJoinError`, `describeMediaError`) outside the component. Now that joining is never automatic (see `network-diagnostics` above), there's a real opportunity: dynamic-`import("livekit-client")` inside `joinRoom()` so the SDK itself only loads on the explicit "Join" click, not just from viewing a voice channel. But threading a dynamically-resolved module through ~900 lines of event handlers and helpers correctly is a substantial, correctness-sensitive rewrite of a file with no way to visually confirm the result here -- do it as its own careful pass with the full `VoiceView.test.tsx` suite (30+ tests) run after every step, not bundled into an unrelated lot.

Remaining lots after that:

1. Full integration pass: responsive behavior, migrations on an existing database, complete tests/build, and deployment documentation verification.
