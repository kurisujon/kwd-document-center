export const roles = ["ADMIN", "STAFF", "VIEWER"] as const;
export type Role = (typeof roles)[number];

export const statuses = ["ACTIVE", "INACTIVE"] as const;
export type UserStatus = (typeof statuses)[number];

export interface AuthorizedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
}

export type AuthorizationResult =
  | { kind: "authorized"; user: AuthorizedUser }
  | { kind: "unauthenticated" }
  | { kind: "not-authorized" }
  | { kind: "inactive" }
  | { kind: "auth-error" };
