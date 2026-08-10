import type { CurrentUser } from "../api/client";
import { Icon } from "../ui/Icon";

function describeCapabilities(capabilities: CurrentUser["capabilities"]): string {
  if (capabilities.includes("manage_server")) return "Admin";
  if (capabilities.includes("manage_channels") || capabilities.includes("moderate")) return "Staff";
  return "Member";
}

export function UserBar({ currentUser, onSignOut }: { currentUser: CurrentUser; onSignOut(): void }) {
  return (
    <div className="user-bar">
      <span className="user-avatar" aria-hidden="true">{currentUser.username.slice(0, 1).toUpperCase()}</span>
      <div className="user-identity">
        <span className="user-name">{currentUser.username}</span>
        <span className="user-role">{describeCapabilities(currentUser.capabilities)}</span>
      </div>
      <button type="button" className="user-action" aria-label="Log out" title="Log out" onClick={() => void onSignOut()}>
        <Icon name="logout" />
      </button>
    </div>
  );
}
