import type { AuthorizationResult, AuthorizedUser } from "../auth/types";
import { isSameOrigin } from "../http/origin";
import { UserRepositoryError, type UserRepository } from "./repository";
import { createUserSchema, updateUserSchema, userIdSchema } from "./validation";

type AuthorizationFailure = Exclude<AuthorizationResult, { kind: "authorized" }>;

function json(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function jsonError(code: string, message: string, status: number, field?: string) {
  return json({ error: { code, message, ...(field ? { field } : {}) } }, status);
}

function authorizationError(authorization: AuthorizationFailure) {
  if (authorization.kind === "unauthenticated") {
    return jsonError("UNAUTHORIZED", "Sign in is required.", 401);
  }
  return jsonError("FORBIDDEN", "You are not authorized to manage users.", 403);
}

function repositoryError(error: unknown) {
  if (!(error instanceof UserRepositoryError)) {
    return jsonError("INTERNAL_ERROR", "User management is temporarily unavailable.", 500);
  }

  switch (error.code) {
    case "ADMIN_REQUIRED":
      return jsonError("ADMIN_REQUIRED", "Active administrator access is required.", 403);
    case "SELF_MODIFICATION_FORBIDDEN":
      return jsonError("SELF_MODIFICATION_FORBIDDEN", "You cannot change your own role or status.", 403);
    case "LAST_ACTIVE_ADMIN":
      return jsonError("LAST_ACTIVE_ADMIN", "At least one active administrator must remain.", 409);
    case "USER_NOT_FOUND":
      return jsonError("USER_NOT_FOUND", "User not found.", 404);
    case "USER_ALREADY_EXISTS":
      return jsonError("USER_ALREADY_EXISTS", "A user with this email is already authorized.", 409);
    case "VALIDATION_ERROR":
      return jsonError("VALIDATION_ERROR", "The user information is invalid.", 400);
    case "EMAIL_IMMUTABLE":
      return jsonError("EMAIL_IMMUTABLE", "User email cannot be changed.", 409);
    default:
      return jsonError("INTERNAL_ERROR", "User management is temporarily unavailable.", 500);
  }
}

function validationError(error: { issues: Array<{ message: string; path: PropertyKey[] }> }) {
  const issue = error.issues[0];
  const field = typeof issue?.path[0] === "string" ? issue.path[0] : undefined;
  return jsonError("VALIDATION_ERROR", issue?.message ?? "The request is invalid.", 400, field);
}

async function requireAdmin(
  getAuthorization: () => Promise<AuthorizationResult>,
): Promise<{ response: Response } | { user: AuthorizedUser }> {
  const authorization = await getAuthorization();
  if (authorization.kind !== "authorized") return { response: authorizationError(authorization) };
  if (authorization.user.role !== "ADMIN") {
    return { response: jsonError("ADMIN_REQUIRED", "Administrator access is required.", 403) };
  }
  return { user: authorization.user };
}

function requiresJson(request: Request) {
  return request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() === "application/json";
}

async function readJson(request: Request): Promise<{ data: unknown } | { response: Response }> {
  try {
    return { data: await request.json() };
  } catch {
    return { response: jsonError("VALIDATION_ERROR", "The JSON request body is invalid.", 400) };
  }
}

type BaseDependencies = {
  getAuthorization: () => Promise<AuthorizationResult>;
  repository: UserRepository;
};

export function createListUsersHandler(dependencies: BaseDependencies) {
  return async function GET() {
    const authorization = await requireAdmin(dependencies.getAuthorization);
    if ("response" in authorization) return authorization.response;

    try {
      const users = await dependencies.repository.listUsers(authorization.user.id);
      return json({ users }, 200);
    } catch (error) {
      return repositoryError(error);
    }
  };
}

export function createCreateUserHandler(dependencies: BaseDependencies) {
  return async function POST(request: Request) {
    const authorization = await requireAdmin(dependencies.getAuthorization);
    if ("response" in authorization) return authorization.response;
    if (!isSameOrigin(request)) return jsonError("FORBIDDEN", "The request origin is not allowed.", 403);
    if (!requiresJson(request)) return jsonError("UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.", 415);

    const body = await readJson(request);
    if ("response" in body) return body.response;
    const validation = createUserSchema.safeParse(body.data);
    if (!validation.success) return validationError(validation.error);

    try {
      const user = await dependencies.repository.createUser(authorization.user.id, validation.data);
      return json({ user }, 201);
    } catch (error) {
      return repositoryError(error);
    }
  };
}

export function createUpdateUserHandler(dependencies: BaseDependencies) {
  return async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const authorization = await requireAdmin(dependencies.getAuthorization);
    if ("response" in authorization) return authorization.response;
    if (!isSameOrigin(request)) return jsonError("FORBIDDEN", "The request origin is not allowed.", 403);
    if (!requiresJson(request)) return jsonError("UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.", 415);

    const { id } = await params;
    const targetId = userIdSchema.safeParse(id);
    if (!targetId.success) return validationError(targetId.error);

    const body = await readJson(request);
    if ("response" in body) return body.response;
    const validation = updateUserSchema.safeParse(body.data);
    if (!validation.success) return validationError(validation.error);

    try {
      const user = await dependencies.repository.updateUser(
        authorization.user.id,
        targetId.data,
        validation.data,
      );
      return json({ user }, 200);
    } catch (error) {
      return repositoryError(error);
    }
  };
}
