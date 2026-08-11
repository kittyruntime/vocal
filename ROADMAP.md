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
- [ ] Voice layouts: pinning, speaker/grid modes, hidden audio-only participants and ordering — **in progress**
- [ ] Call network diagnostics and automatic quality adaptation
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
