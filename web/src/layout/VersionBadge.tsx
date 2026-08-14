import type { VersionInfo } from "../api/client";

export function VersionBadge({ version, onClick }: { version: VersionInfo | null; onClick: () => void }) {
  if (!version) return null;
  return <button type="button" className="version-badge" onClick={onClick} title="View version and changelog">v{version.version}</button>;
}
