import type { CurrentUser } from "../api/client";
import { AuthenticatedImage } from "../ui/AuthenticatedImage";
import { Icon } from "../ui/Icon";

function describeCapabilities(capabilities: CurrentUser["capabilities"]): string {
  if (capabilities.includes("manage_server")) return "Admin";
  if (capabilities.includes("manage_channels") || capabilities.includes("moderate")) return "Staff";
  return "Member";
}

export function UserBar({ currentUser, onOpenProfile, onSignOut }: { currentUser: CurrentUser; onOpenProfile(): void; onSignOut(): void }) {
  return (
    <div className="user-bar">
      <button type="button" className="user-profile-button" aria-label="Edit profile" onClick={onOpenProfile}>
        <span className="user-avatar" aria-hidden="true">{currentUser.avatarUrl ? <AuthenticatedImage src={currentUser.avatarUrl} alt="" /> : currentUser.username.slice(0, 1).toUpperCase()}</span>
      </button>
      <div className="user-identity">
        <span className="user-name">{currentUser.username}</span>
        <span className="user-role">{describeCapabilities(currentUser.capabilities)}</span>
      </div>
      <button type="button" className="user-action" aria-label="User settings" title="User settings" onClick={onOpenProfile}>
        <Icon name="settings" />
      </button>
      <button type="button" className="user-action" aria-label="Log out" title="Log out" onClick={() => void onSignOut()}>
        <Icon name="logout" />
      </button>
    </div>
  );
}
