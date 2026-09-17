import type { Role, UserStatus } from "../auth/types";

export interface ManagedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateUserInput {
  email: string;
  name: string;
  role: Role;
}

export interface UpdateUserInput {
  role?: Role;
  status?: UserStatus;
}
