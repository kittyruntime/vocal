# Vocal desktop client

An Electron shell around the same `web/` app, for platforms/browsers where
`getUserMedia` device permissions have proven unreliable (Firefox in
particular). Loads the built web app locally and points it at whatever
self-hosted Vocal server the user enters on first launch.

## Dev

```bash
pnpm -C web dev                 # http://localhost:5173
pnpm -C desktop dev              # opens Electron pointed at the Vite dev server
```

## Build & package

```bash
pnpm -C web build                # produces web/dist
pnpm -C desktop dist             # copies web/dist in, then runs electron-builder
```

Output lands in `desktop/release/` — an NSIS installer on Windows, a `.dmg`
on macOS, and an AppImage/`.deb` on Linux. The build is currently unsigned:
Windows SmartScreen and macOS Gatekeeper will both warn on first launch
until a code-signing certificate is added.

## Releasing

Version and changelog entries live at the repo root (`VERSION`,
`CHANGELOG.md`), not in this package.

1. Add the release's notes under `## [Unreleased]` in `CHANGELOG.md` as you go.
2. When ready to cut a release: `pnpm release <version>` from the repo root
   (e.g. `pnpm release 0.2.0`). This bumps `VERSION`, moves the `[Unreleased]`
   entries under a dated heading, syncs `desktop/package.json`'s version, and
   commits + tags `vX.Y.Z` locally.
3. `git push origin main --tags` — pushing the tag triggers
   `.github/workflows/release.yml`, which builds the Windows, Linux, and
   macOS clients (macOS is best-effort and won't block the release if it
   fails) and publishes them as a GitHub Release with that version's
   changelog section as the release notes.

## What's not there yet

- Code signing / notarization
- Auto-update
- A proper screen/window picker for screen sharing (the primary screen is
  auto-selected)
