# Changelog

All notable changes to Vocal are documented here.

## [Unreleased]

## [0.3.1] - 2026-09-04

### Fixed
- The in-app changelog/about modal no longer renders transparent and illegible -- it now uses the defined theme tokens.
- Profile avatars and chat attachment images now load in the desktop client (and any Bearer-token session) by fetching with the auth token and rendering blob URLs instead of plain `<img>` tags.
- The chat composer attach button now shows a paperclip icon with a subtle style instead of the off-looking plus-in-circle.
- Screen sharing in the desktop client no longer fails silently when no screen source is available -- it logs the cause and shows an explanatory dialog (e.g. missing macOS Screen Recording permission).

## [0.3.0] - 2026-08-27

### Added
- The desktop client now checks for updates automatically (on startup and every 4 hours) and offers to restart and install them once downloaded -- no more manual reinstalls for Windows and Linux (AppImage) users. macOS auto-update is wired up but won't apply updates until the app is code-signed.

### Changed
- The desktop app now shows its real icon (instead of a placeholder square) and hides the unused default menu bar.

## [0.2.1] - 2026-08-27

### Fixed
- The Linux desktop build failed to produce a `.deb` package because required package metadata (homepage, author email) was missing.

## [0.2.0] - 2026-08-25

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
