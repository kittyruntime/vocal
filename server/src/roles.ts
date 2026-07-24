export type Role = "admin" | "moderator" | "member";

const RANK: Record<Role, number> = { admin: 3, moderator: 2, member: 1 };

export function roleRank(role: Role): number {
  return RANK[role];
}

export function hasAtLeastRole(userRole: Role, minRole: Role): boolean {
  return RANK[userRole] >= RANK[minRole];
}
