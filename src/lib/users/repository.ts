import type { SupabaseClient } from "@supabase/supabase-js";
import { managedUserSchema } from "./validation";
import type { CreateUserInput, ManagedUser, UpdateUserInput } from "./types";

const knownDatabaseCodes = [
  "ADMIN_REQUIRED",
  "SELF_MODIFICATION_FORBIDDEN",
  "LAST_ACTIVE_ADMIN",
  "USER_NOT_FOUND",
  "USER_ALREADY_EXISTS",
  "VALIDATION_ERROR",
  "EMAIL_IMMUTABLE",
] as const;

export type UserRepositoryErrorCode = (typeof knownDatabaseCodes)[number] | "UNKNOWN";

export class UserRepositoryError extends Error {
  readonly code: UserRepositoryErrorCode;

  constructor(code: UserRepositoryErrorCode) {
    super("User repository operation failed.");
    this.code = code;
  }
}

export interface UserRepository {
  listUsers(actorId: string): Promise<ManagedUser[]>;
  createUser(actorId: string, input: CreateUserInput): Promise<ManagedUser>;
  updateUser(actorId: string, targetId: string, input: UpdateUserInput): Promise<ManagedUser>;
}

export function createLazyUserRepository(factory: () => UserRepository): UserRepository {
  return {
    listUsers: (actorId) => factory().listUsers(actorId),
    createUser: (actorId, input) => factory().createUser(actorId, input),
    updateUser: (actorId, targetId, input) => factory().updateUser(actorId, targetId, input),
  };
}

type RpcClient = Pick<SupabaseClient, "rpc">;

function repositoryError(error: unknown): UserRepositoryError {
  const message = typeof error === "object" && error !== null && "message" in error
    ? String(error.message)
    : "";
  const code = knownDatabaseCodes.find((candidate) => message.includes(candidate));
  return new UserRepositoryError(code ?? "UNKNOWN");
}

function mapUser(value: unknown): ManagedUser {
  const parsed = managedUserSchema.safeParse(value);
  if (!parsed.success) throw new UserRepositoryError("UNKNOWN");
  return parsed.data;
}

function oneUser(data: unknown): ManagedUser {
  if (!Array.isArray(data) || data.length !== 1) throw new UserRepositoryError("UNKNOWN");
  return mapUser(data[0]);
}

export function createUserRepository(supabase: RpcClient): UserRepository {
  return {
    async listUsers(actorId) {
      const { data, error } = await supabase.rpc("admin_list_users", { actor_id: actorId });
      if (error) throw repositoryError(error);
      if (!Array.isArray(data)) throw new UserRepositoryError("UNKNOWN");
      return data.map(mapUser);
    },

    async createUser(actorId, input) {
      const { data, error } = await supabase.rpc("admin_create_user", {
        actor_id: actorId,
        p_email: input.email,
        p_name: input.name,
        p_role: input.role,
      });
      if (error) throw repositoryError(error);
      return oneUser(data);
    },

    async updateUser(actorId, targetId, input) {
      const { data, error } = await supabase.rpc("admin_update_user", {
        actor_id: actorId,
        target_id: targetId,
        p_role: input.role ?? null,
        p_status: input.status ?? null,
      });
      if (error) throw repositoryError(error);
      return oneUser(data);
    },
  };
}
