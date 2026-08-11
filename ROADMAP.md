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
- [x] LiveKit bundle deferred until Join click
- [x] Chat message list bounded (cap, not full virtualization -- see notes below)
- [ ] Final integration, responsive and deployment verification — **next**

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
- `livekit-deferred-load`: `livekit-client`'s value imports in `VoiceView.tsx` (Room, RoomEvent, Track, ConnectionQuality, VideoQuality, MediaDeviceFailure, ConnectionError/Reason, createAudioAnalyser) switched to type-only imports plus a `loadLiveKit()` → `import("livekit-client")` helper called from `joinRoom()` and every other function that only runs once a room exists. Confirmed via the production build: `VoiceView` chunk dropped from ~517 kB to ~28 kB, with `livekit-client` now its own ~527 kB chunk that only loads on the "Join" click (not just from viewing a voice channel). Full `VoiceView.test.tsx` suite (30 tests) still passes -- `vi.mock("livekit-client")` covers dynamic imports the same as static ones.
- `chat-message-cap`: `ChatView.tsx` now caps loaded messages at `MAX_LOADED_MESSAGES = 300` per channel instead of growing without bound. `loadMore()` (scroll-up pagination) stops fetching further history once the cap is hit, without ever discarding messages the user might be reading. Separately, once live WebSocket messages push the total over the cap while the user is near the bottom, the oldest messages are trimmed via the existing `onMessagesLoaded` callback. True windowed virtualization (`react-window`) was evaluated and explicitly rejected for this pass -- see the note under Handoff.

## Security fixes

- SVG attachments were served with `Content-Disposition: inline` (any client-supplied `image/*` MIME type was trusted), and the web client linked directly to that URL for anything it treated as an image -- a stored XSS, since SVG can carry `<script>`/event handlers that execute when opened as a top-level document. Fixed by restricting inline rendering to an explicit raster-image allowlist (`server/src/routes/messages.ts`'s `INLINE_SAFE_MIME_TYPES`, mirrored client-side in `web/src/layout/ChatView.tsx`); anything outside it, including SVG, is always forced to download, plus `X-Content-Type-Options: nosniff` and a restrictive CSP on that response. **Do not widen that allowlist back to a bare `startsWith("image/")` check.**

## Handoff for Claude

Branch state: `main` is clean and synchronized with `origin/main` at `a8d78a4`.

Last verified test baseline:

- server: 14 files, 101 tests passing;
- web: 18 files, 137 tests passing;
- server and web TypeScript checks passing;
- production web build passing: `VoiceView` chunk ~28 kB, `livekit-client` split into its own ~527 kB chunk loaded only on Join (the remaining >500 kB chunk-size warning is that livekit-client chunk itself, which is expected -- see `livekit-deferred-load` above).

**Why chat messages use a cap instead of true virtualization** (don't re-attempt windowed rendering without reading this first): this test environment (jsdom) implements neither `Element.scrollTo`, `ResizeObserver`, nor a real layout engine (`getBoundingClientRect` always returns zeros). A virtualization library (evaluated: `react-window` v2, a very different and simpler API than v1) depends on all three to measure its container and rows. That means a windowed rewrite of `ChatView.tsx`'s message list could not be verified by any automated test here -- it would ship as a large rewrite of an always-on feature with no working safety net beyond "it typechecks." Asked the user directly; they chose the safer bound (see `chat-message-cap` above) over shipping that risk. If real virtualization is wanted later, it needs to happen where actual browser testing is possible (Playwright against a real browser engine, or manual verification), not here.

Next lot: **final integration pass** -- responsive behavior across the app (not just voice/mobile nav, which are already done), migrations verified against an existing/seeded database (not just a fresh one via `makeTestDb`), full test/typecheck/build sweep, and deployment documentation verification (docker-compose, env vars, TURN/TLS notes if any exist). No code for this lot has been written yet; start by auditing what "responsive" and "deployment documentation" concretely mean for this repo today (e.g. is there a README or deployment doc at all? check before assuming one needs to be written from scratch).
