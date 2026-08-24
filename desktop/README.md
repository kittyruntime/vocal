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

## What's not there yet

- Code signing / notarization
- Auto-update
- A proper screen/window picker for screen sharing (the primary screen is
  auto-selected)
- `build/icon.png` and `build/tray.png` are flat placeholder squares —
  swap them for real icons before shipping
