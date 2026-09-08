import type { Role } from "./types";

const roleRank: Record<Role, number> = {
  VIEWER: 1,
  STAFF: 2,
  ADMIN: 3,
};

export function hasMinimumRole(role: Role, minimumRole: Role): boolean {
  return roleRank[role] >= roleRank[minimumRole];
}
