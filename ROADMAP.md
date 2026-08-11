# Vocal roadmap

Last updated: 2026-08-11 (admin-sound-settings)

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
- [x] Final integration: migration verification, deployment docs, responsive audit
- [x] Admin-configurable notification sounds, two new sound events (mic mute/unmute, moderator force-mute) and per-user volume

All planned lots for this product pass are now delivered. See "Next steps"
under Handoff for what's left, none of it blocking.

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
- `final-integration`: added `README.md` (didn't exist before) covering local dev, the full server env-var reference, and a generic production deployment guide around the existing `deploy/*.Dockerfile`/`deploy/nginx.conf` -- both images rebuilt successfully against the current codebase, confirming they weren't stale. Verified `server/src/db/migrate.ts`'s full migration set (001 → 014) applies cleanly on top of realistic pre-existing data: seeded a database at the old `005_moderation.sql` schema with users of every legacy role and channels of every legacy `min_role`, ran the current `migrate()` against it, and confirmed every user/channel/message survived with role/min_role correctly backfilled into capabilities (admin → all 4, moderator → moderate+publish_voice, member → publish_voice; channel min_role → required_capability) and idempotent on re-run. Audited responsive coverage across the newer modals (search, profile, public profile, invite/role managers, emote picker, attachment grids) added since the earlier mobile-nav pass -- found already covered by existing `min(Npx, 100%)` sizing and the 520px/760px breakpoints; no gaps found, no changes made.
- `admin-sound-settings`: server-wide, per-event sound control from the admin panel plus per-user volume from profile settings. New `server_sounds` table (5 events: `message`, `userJoin`, `userLeave`, and two new ones -- `muteToggle` for the local mic mute/unmute click, `forceMuted` for when a moderator revokes your `publish_voice` while you're connected, detected client-side via livekit-client's `RoomEvent.ParticipantPermissionsChanged`) holds an `enabled` flag and an optional custom-uploaded `audio_data` (data-URL, same storage pattern as avatar/banner) per event; `users.sound_volumes jsonb` holds each user's own 0-100 volume per event, defaulting to 55. New route file `server/src/routes/sounds.ts` (`GET /api/sounds`, `GET /api/sounds/:event/file`, `PATCH /api/admin/sounds/:event` -- `manage_server` only, with its own `bodyLimit: 8 * 1024 * 1024` route override since the server's global Fastify body limit is 2 MB and custom uploads run up to ~7 MB base64 -- and `GET`/`PATCH /api/me/sound-volumes`). `web/src/audio/sounds.ts` rewritten from a hardcoded 3-sound player into a small config-driven engine (`configureSounds`/`previewSound`/`playAppSound`) loaded once on `MainLayout` mount, exactly like `chat-settings` -- no realtime broadcast of admin changes, picked up on next page load by design. Admin panel gets a new "Sounds" tab (enable/disable, upload, preview, reset-to-default per event); the profile modal gets a new "Notification sounds" section with a volume slider (saves on release, not on every drag tick) and preview per event. Two placeholder default audio assets (`mute-toggle.mp3`, `force-muted.mp3`) synthesized with `ffmpeg`. Two real bugs were found and fixed during implementation (not left for a reviewer to catch): the route-level `bodyLimit` gap above, and two test-authoring bugs in the admin-panel test brief (an ambiguous `{name: "On"}` query matching all 5 rows, and a mock-setup call silently clobbered by the test helper's own default mock) -- fixed at the test-mechanics level only, no assertions or component code changed to route around them. Manually verified end-to-end against a live server on an isolated throwaway database (never the shared dev DB): setup, toggle, upload/serve/reset round-trip, and per-user volume update all confirmed working outside the test suite.

## Security fixes

- SVG attachments were served with `Content-Disposition: inline` (any client-supplied `image/*` MIME type was trusted), and the web client linked directly to that URL for anything it treated as an image -- a stored XSS, since SVG can carry `<script>`/event handlers that execute when opened as a top-level document. Fixed by restricting inline rendering to an explicit raster-image allowlist (`server/src/routes/messages.ts`'s `INLINE_SAFE_MIME_TYPES`, mirrored client-side in `web/src/layout/ChatView.tsx`); anything outside it, including SVG, is always forced to download, plus `X-Content-Type-Options: nosniff` and a restrictive CSP on that response. **Do not widen that allowlist back to a bare `startsWith("image/")` check.**

## Handoff for Claude

Branch state: `admin-sound-settings` lot was built on `worktree-admin-sound-settings`, based off `main` at `1ae9f54` (10 commits ahead), pushed to `origin/worktree-admin-sound-settings`. `main` itself is still at `1ae9f54` -- this branch has not been merged. Decide merge/PR with the user before closing this out (see `superpowers:finishing-a-development-branch`).

Last verified test baseline (on `worktree-admin-sound-settings`):

- server: 15 files, 112 tests passing;
- web: 19 files, 149 tests passing;
- server and web TypeScript checks passing;
- production web build passing: `VoiceView` chunk ~28 kB (unchanged), `livekit-client` still its own ~527 kB chunk loaded only on Join (the remaining >500 kB chunk-size warning is that livekit-client chunk itself, which is expected -- see `livekit-deferred-load` above); web CSS bundle ~56 kB;
- `pnpm -C server build` passing;
- live end-to-end smoke test against a real running server (isolated throwaway database, not the shared dev DB) confirmed the full sound-settings flow outside the test suite -- see `admin-sound-settings` above.

**Why chat messages use a cap instead of true virtualization** (don't re-attempt windowed rendering without reading this first): this test environment (jsdom) implements neither `Element.scrollTo`, `ResizeObserver`, nor a real layout engine (`getBoundingClientRect` always returns zeros). A virtualization library (evaluated: `react-window` v2, a very different and simpler API than v1) depends on all three to measure its container and rows. That means a windowed rewrite of `ChatView.tsx`'s message list could not be verified by any automated test here -- it would ship as a large rewrite of an always-on feature with no working safety net beyond "it typechecks." Asked the user directly; they chose the safer bound (see `chat-message-cap` above) over shipping that risk. If real virtualization is wanted later, it needs to happen where actual browser testing is possible (Playwright against a real browser engine, or manual verification), not here.

All lots originally planned for this product pass are delivered. Nothing
queued is blocking; pick based on what the user actually wants next.

Next steps (none urgent, roughly in order of value):

1. **TURN server + TLS hardening** -- still not configured anywhere (see README's "Known gaps"). Matters once real users are behind restrictive NATs.
2. **Real E2E verification** -- a two-browser LiveKit join has only ever been checked manually/ad hoc in this project's history, never automated. Playwright against a real browser is also the only way to properly attempt chat-list virtualization later (see the jsdom limitation noted above).
3. Server-side pagination was only done for `/api/admin/users` this pass -- check whether search results or other list endpoints have grown large enough on a real deployment to need the same treatment.
