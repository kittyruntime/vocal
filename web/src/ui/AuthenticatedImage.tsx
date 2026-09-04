import { useEffect, useState } from "react";
import { fetchWithAuth, getAuthToken } from "../api/client";

/**
 * Resolves an authenticated (`/api/...`) URL to a blob object URL when the
 * app is running under Bearer-token auth (desktop client), where a plain
 * `<img src>` could never send the `Authorization` header and would 401.
 *
 * - `data:` / `blob:` URLs pass through untouched (no fetch needed).
 * - Cookie auth (no token set, normal web deployment) returns the original
 *   URL untouched, so behaviour there is byte-for-byte what it was before.
 * - Bearer auth fetches with the token attached and returns an object URL.
 *   Returns `null` while loading (or on failure, so callers can fall back
 *   to an initial-letter placeholder instead of a broken-image icon).
 */
export function useAuthenticatedUrl(src: string | null | undefined): string | null {
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    if (!src || src.startsWith("data:") || src.startsWith("blob:")) {
      setResolved(null);
      return;
    }
    if (!getAuthToken()) {
      setResolved(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const res = await fetchWithAuth(src);
        if (!res.ok || cancelled) return;
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setResolved(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      } catch {
        if (!cancelled) setResolved(null);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (!src) return null;
  if (src.startsWith("data:") || src.startsWith("blob:")) return src;
  if (!getAuthToken()) return src;
  return resolved;
}

export function AuthenticatedImage({
  src,
  alt,
  loading,
  className,
}: {
  src: string;
  alt: string;
  loading?: "lazy" | "eager";
  className?: string;
}) {
  const resolved = useAuthenticatedUrl(src);
  // While the blob is loading (or if it failed), render nothing instead of
  // a broken `<img src>` that would 401 — the parent's initial-letter
  // fallback stays visible via CSS `:empty` / missing img.
  if (resolved === null && getAuthToken() && !src.startsWith("data:") && !src.startsWith("blob:")) {
    return null;
  }
  return <img src={resolved ?? src} alt={alt} loading={loading} className={className} />;
}
