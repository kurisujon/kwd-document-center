import type { Role } from "./types";

const roleRank: Record<Role, number> = {
  VIEWER: 1,
  STAFF: 2,
  ADMIN: 3,
};

export function hasMinimumRole(role: Role, minimumRole: Role): boolean {
  return roleRank[role] >= roleRank[minimumRole];
}

export function canReadDocument(
  user: { role: Role; status?: "ACTIVE" | "INACTIVE" },
  document: { deletion_state?: string | null; confidential?: boolean | null },
): boolean {
  if (user.status && user.status !== "ACTIVE") return false;
  if (document.deletion_state && document.deletion_state !== "ACTIVE") return false;
  if (document.confidential && user.role !== "ADMIN") return false;
  return true;
}
