import type { VersionInfo } from "../api/client";

export function VersionBadge({ version, onClick }: { version: VersionInfo | null; onClick: () => void }) {
  if (!version) return null;
  return <button type="button" className="version-badge" onClick={onClick} title={`About Vocal (v${version.version})`}>About Vocal</button>;
}
