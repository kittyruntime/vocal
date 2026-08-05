import type { ConnectionStatus } from "../ws/socketClient";

export function ConnectionBanner({ status }: { status: ConnectionStatus }) {
  return (
    <div className="connection-banner" role="status">
      {status === "connecting" ? "Connexion…" : "Connexion perdue"}
    </div>
  );
}
