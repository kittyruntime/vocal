import type { CurrentUser } from "../api/client";

const ROLE_LABEL: Record<CurrentUser["role"], string> = {
  admin: "Admin",
  moderator: "Modérateur",
  member: "Membre",
};

export function UserBar({ currentUser, onSignOut }: { currentUser: CurrentUser; onSignOut(): void }) {
  return (
    <div className="user-bar">
      <span className="user-avatar" aria-hidden="true">{currentUser.username.slice(0, 1).toUpperCase()}</span>
      <div className="user-identity">
        <span className="user-name">{currentUser.username}</span>
        <span className="user-role">{ROLE_LABEL[currentUser.role]}</span>
      </div>
      <button type="button" className="user-action" aria-label="Déconnexion" title="Se déconnecter" onClick={() => void onSignOut()}>
        ↪
      </button>
    </div>
  );
}
