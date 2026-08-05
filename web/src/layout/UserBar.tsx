import type { CurrentUser } from "../api/client";

const ROLE_LABEL: Record<CurrentUser["role"], string> = {
  admin: "Admin",
  moderator: "Modérateur",
  member: "Membre",
};

export function UserBar({ currentUser, onSignOut }: { currentUser: CurrentUser; onSignOut(): void }) {
  return (
    <div className="user-bar">
      <div className="user-identity">
        <span className="user-name">{currentUser.username}</span>
        <span className="user-role">{ROLE_LABEL[currentUser.role]}</span>
      </div>
      <button type="button" onClick={() => void onSignOut()}>
        Déconnexion
      </button>
    </div>
  );
}
