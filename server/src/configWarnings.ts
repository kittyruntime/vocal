// Startup sanity checks for production deployments. These only warn: an
// operator may have a legitimate reason (a LAN-only install over plain HTTP),
// so refusing to boot would be worse than a loud log line.

const DEV_LIVEKIT_KEY = "devkey";
const DEV_LIVEKIT_SECRET = "secret";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

export function productionConfigWarnings(env: NodeJS.ProcessEnv): string[] {
  if (env.NODE_ENV !== "production") return [];
  const warnings: string[] = [];

  const url = env.LIVEKIT_URL;
  if (url) {
    if (url.startsWith("ws://")) {
      warnings.push(
        "LIVEKIT_URL uses ws:// -- browsers block it from an https:// page (mixed content). " +
          "Put LiveKit behind TLS and use its public wss:// URL.",
      );
    }
    let host: string | null = null;
    try {
      host = new URL(url).hostname;
    } catch {
      warnings.push(`LIVEKIT_URL is not a valid URL: ${url}`);
    }
    if (host && LOCAL_HOSTS.has(host)) {
      warnings.push(
        `LIVEKIT_URL points at ${host}, which remote browsers cannot reach. ` +
          "It is returned as-is to clients, so it must be LiveKit's public URL.",
      );
    }
  }

  if (env.LIVEKIT_API_KEY === DEV_LIVEKIT_KEY || env.LIVEKIT_API_SECRET === DEV_LIVEKIT_SECRET) {
    warnings.push(
      "LIVEKIT_API_KEY/LIVEKIT_API_SECRET are the livekit-server --dev defaults. " +
        "Anyone can mint tokens for your LiveKit server; generate a real pair.",
    );
  }

  if (env.COOKIE_SECURE === "false") {
    warnings.push("COOKIE_SECURE=false in production: session cookies will be sent over plain HTTP.");
  }

  return warnings;
}
