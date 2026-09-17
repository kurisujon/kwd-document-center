import { z } from "zod";
import { managedUserSchema } from "./validation";
import type { CreateUserInput, ManagedUser, UpdateUserInput } from "./types";

type Fetcher = typeof fetch;

const errorResponseSchema = z.object({
  error: z.object({ code: z.string() }),
});

const listResponseSchema = z.object({
  users: z.array(managedUserSchema),
});

const userResponseSchema = z.object({
  user: managedUserSchema,
});

export function userManagementErrorMessage(code: string) {
  switch (code) {
    case "USER_ALREADY_EXISTS":
      return "This email is already authorized.";
    case "SELF_MODIFICATION_FORBIDDEN":
      return "You cannot change your own role or deactivate your own account.";
    case "LAST_ACTIVE_ADMIN":
      return "This change cannot be completed because at least one active administrator must remain.";
    case "USER_NOT_FOUND":
      return "This user no longer exists. Refresh the list.";
    case "ADMIN_REQUIRED":
    case "FORBIDDEN":
    case "UNAUTHORIZED":
      return "You no longer have permission to manage users.";
    case "VALIDATION_ERROR":
      return "Check the entered information and try again.";
    case "EMAIL_IMMUTABLE":
      return "User email cannot be changed.";
    default:
      return "Something went wrong. Try again.";
  }
}

export class UserManagementApiError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(userManagementErrorMessage(code));
    this.code = code;
  }
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function request<T>(
  fetcher: Fetcher,
  input: string,
  init: RequestInit,
  parse: (value: unknown) => { success: true; data: T } | { success: false },
): Promise<T> {
  try {
    const response = await fetcher(input, init);
    const body = await responseBody(response);
    if (!response.ok) {
      const error = errorResponseSchema.safeParse(body);
      throw new UserManagementApiError(error.success ? error.data.error.code : "INTERNAL_ERROR");
    }
    const result = parse(body);
    if (!result.success) throw new UserManagementApiError("INTERNAL_ERROR");
    return result.data;
  } catch (error) {
    if (error instanceof UserManagementApiError) throw error;
    throw new UserManagementApiError("INTERNAL_ERROR");
  }
}

export function fetchManagedUsers(fetcher: Fetcher = fetch) {
  return request(
    fetcher,
    "/api/admin/users",
    { method: "GET", cache: "no-store" },
    (value) => listResponseSchema.safeParse(value),
  );
}

export function createManagedUser(input: CreateUserInput, fetcher: Fetcher = fetch) {
  return request(
    fetcher,
    "/api/admin/users",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    (value) => userResponseSchema.safeParse(value),
  );
}

export function updateManagedUser(id: string, input: UpdateUserInput, fetcher: Fetcher = fetch) {
  return request(
    fetcher,
    `/api/admin/users/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    (value) => userResponseSchema.safeParse(value),
  );
}

export function replaceManagedUser(users: ManagedUser[], updated: ManagedUser) {
  return users.map((user) => user.id === updated.id ? updated : user);
}

export function addManagedUser(users: ManagedUser[], created: ManagedUser) {
  return [...users, created].sort((left, right) => left.email.localeCompare(right.email));
}
