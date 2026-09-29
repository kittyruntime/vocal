# Vocal

A self-hosted, Discord/Mumble-style chat and voice server: text channels,
threaded/reactable messages with attachments, named roles and capabilities,
and voice/video channels backed by a self-hosted [LiveKit](https://livekit.io/)
SFU.

- `server/` — Fastify + PostgreSQL API and WebSocket backend.
- `web/` — React + Vite single-page client.
- `desktop/` — Electron shell around the same web client, for a native
  Windows/macOS/Linux app that connects to any self-hosted server URL. See
  `desktop/README.md`.
- `deploy/` — Dockerfiles and nginx config for a production build.

## Requirements

- Node.js 22+, [pnpm](https://pnpm.io/) (`corepack enable` picks up the
  version pinned in `package.json`).
- Docker, for PostgreSQL and LiveKit in development (or your own instances).

## Local development

```bash
docker compose -f docker-compose.dev.yml up -d   # postgres + livekit (--dev keys)
pnpm install
cp .env.example server/.env                      # then edit as needed
pnpm -C server dev                                # http://localhost:3000
pnpm -C web dev                                   # http://localhost:5173, proxies /api and /ws to :3000
```

The server applies pending SQL migrations from `server/migrations/`
automatically on startup (see `server/src/db/migrate.ts`) — there is no
separate migration command to run. The first account created via the app's
setup screen is granted every capability.

### Versioning

The running version is read from the root `VERSION` file and is available at
`/api/version`. Update that file to bump the deployed version. `CHANGELOG.md`
is also served at `/api/changelog` and can be opened from the sidebar version
badge in the web app.

### Tests, typecheck, build

```bash
pnpm -C server test && pnpm -C server typecheck && pnpm -C server build
pnpm -C web test && pnpm -C web typecheck && pnpm -C web build
```

Server tests need a running PostgreSQL (`docker-compose.dev.yml`); they
create and drop a `vocal_test` database on each run.

## Environment variables

Set on the `server` process (see `.env.example`):

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | `postgres://user:pass@host:5432/db` |
| `MESSAGE_MASTER_KEY` | yes | Base64, 32 bytes (`openssl rand -base64 32`). Encrypts message content at rest. **Never rotate this after messages have been stored — they become permanently unreadable.** |
| `COOKIE_SECURE` | no | Defaults to secure (HTTPS-only) cookies; set to `false` only for local HTTP development. |
| `APP_ORIGIN` | recommended in production | Comma-separated allowlist of browser origins permitted to open the `/ws` WebSocket (anti-CSWSH). Unset defaults to a same-origin check against the `Host` header, which is enough for a single-domain deployment behind a reverse proxy that forwards `Host` correctly. |
| `LIVEKIT_URL` | yes | The LiveKit server's WebSocket URL, returned as-is to the browser. In production this **must** be the publicly reachable `wss://` URL — never an internal/Docker-only hostname. |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | yes | Must match the keys configured on the LiveKit server itself. Never reuse the dev defaults (`devkey` / `secret`) in production. |

The web client needs no build-time environment variables — it calls `/api`
and `/ws` on its own origin; a reverse proxy (see `deploy/nginx.conf`) routes
those to the server.

## Production deployment

`deploy/server.Dockerfile` and `deploy/web.Dockerfile` build production
images for the two apps (multi-stage, pnpm workspace–aware); `deploy/nginx.conf`
serves the built web client and reverse-proxies `/api` and `/ws` to the
server container. There is no bundled orchestration file in this repo (a
previous Coolify-specific `docker-compose.coolify.yml` was intentionally
removed) — assemble a compose file (or your platform's equivalent) with four
services:

1. **postgres** — `postgres:16-alpine`, persistent volume.
2. **livekit** — `livekit/livekit-server:latest`, configured from
   [`deploy/livekit.yaml`](deploy/livekit.yaml) (mounted with `--config`, or
   pasted into its `LIVEKIT_CONFIG` environment variable): a real (non-dev)
   API key/secret pair, a `webhook.urls` entry pointing at the server's
   `/api/voice/webhook`, and TURN (see "TURN and TLS" below).
3. **server** — built from `deploy/server.Dockerfile`, the env vars above,
   `expose`d on 3000 (not published directly).
4. **web** — built from `deploy/web.Dockerfile`, `expose`d on 80, fronted by
   your TLS-terminating reverse proxy/load balancer.

Generate production secrets on a trusted machine, never reuse dev defaults:

```bash
openssl rand -base64 32  # MESSAGE_MASTER_KEY
openssl rand -hex 16     # LIVEKIT_API_KEY
openssl rand -hex 32     # LIVEKIT_API_SECRET
```

Firewall: only the reverse proxy's HTTP(S) ports, LiveKit's media ports
(`7881/tcp` WebRTC-over-TCP fallback, `7882/udp` WebRTC media) and, with TURN
enabled, the TURN ports below need to be open publicly. PostgreSQL, the
server's port 3000 and LiveKit's signaling port 7880 should not be published
directly (7880 is reached through the reverse proxy as `wss://`).

### TURN and TLS

Without TURN, clients behind symmetric NATs or firewalls that only allow
outbound HTTPS (common on corporate and campus networks) join a voice channel
but never get audio. LiveKit has a TURN server built in;
[`deploy/livekit.yaml`](deploy/livekit.yaml) is a production config with it
enabled. Clients need no change: LiveKit hands its TURN servers to the browser
and desktop app when they connect.

1. **Signaling over TLS.** Route a hostname (e.g. `livekit.example.com`)
   through your TLS-terminating reverse proxy to LiveKit's port 7880, with
   WebSocket upgrades allowed, and set the server's `LIVEKIT_URL` to
   `wss://livekit.example.com`. A `ws://` URL is blocked by browsers from an
   `https://` page.
2. **TURN hostname and certificate.** Create a DNS record such as
   `turn.example.com` pointing straight at the LiveKit host (not through an
   HTTP proxy or CDN) and set it as `turn.domain`. Either mount a certificate
   for it and set `turn.cert_file`/`turn.key_file` (the default in the sample),
   or terminate TLS on a layer-4 TCP load balancer and set
   `turn.external_tls: true`. An HTTP reverse proxy cannot front TURN.
   When LiveKit terminates TLS itself, its TURN/TLS port must be `443`, so the
   LiveKit host cannot also run your HTTPS proxy on 443; use a separate host
   or IP, or the layer-4 load balancer setup.
3. **Open the TURN ports**: `443/tcp` (TURN over TLS), `3478/udp` (TURN over
   UDP) and the relay range `30000-30999/udp`.
4. **Verify.** Join a voice channel from a network that blocks UDP (or from
   Chrome with `chrome://webrtc-internals` open and a restrictive firewall);
   the selected ICE candidate pair should show a `relay` candidate and audio
   should flow.

The server logs a `[config]` warning at startup (with `NODE_ENV=production`,
which the Docker image sets) when `LIVEKIT_URL` is `ws://` or a loopback
address, when the LiveKit key pair is the `--dev` default, or when
`COOKIE_SECURE=false`.

TLS for the web app itself stays with your reverse proxy/platform: terminate
HTTPS there and forward `X-Forwarded-Proto`, which `deploy/nginx.conf` passes
through to the server.

After deploying: check `/api/health` returns `{"status":"ok"}`, create the
first account (becomes the initial admin), create a voice channel, and join
it from two separate browsers/devices to confirm audio and presence both
work end-to-end.

### Known gaps (see `ROADMAP.md`)

- **TURN is opt-in.** `deploy/livekit.yaml` enables it, but it needs its own
  DNS name, certificate and open ports (see "TURN and TLS" above); a LiveKit
  deployed without it fails for clients behind restrictive NATs.
- **TLS termination is left to your reverse proxy/platform** — not configured
  in this repo.

## Further reading

- `ROADMAP.md` — current feature status and what's being worked on next.
