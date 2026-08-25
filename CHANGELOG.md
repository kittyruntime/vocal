# Changelog

All notable changes to Vocal are documented here.

## [Unreleased]

### Added
- Direct messages and group conversations, alongside server channels, with full feature parity (attachments, reactions, replies, edit/delete, search).
- A native desktop client for Windows, macOS, and Linux, so voice calls no longer depend on the browser's microphone permission handling.
- Real-time noise reduction for voice calls (RNNoise), on by default.
- An "Ultra" media quality preset for microphone, webcam, and screen share, above "High".
- A one-click "Message" button on user profiles to start a direct message.
- An online members list in the sidebar.
- Runtime version information and an in-app changelog viewer.

### Changed
- Reorganized the sidebar into clearer sections (channels, then conversations, then online members) and removed a duplicated online-member count.

### Fixed
- An open direct message no longer gets silently swapped for a channel if the channel list finishes loading after the conversation was already selected.

## [0.1.0] - 2026-08-14

### Added
- Initial versioned release of the self-hosted chat and voice platform.
