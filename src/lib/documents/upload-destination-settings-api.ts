import { z } from "zod";
import type { AuthorizationResult } from "../auth/types";
import { isSameOrigin } from "../http/origin";
import { protectedJson } from "../http/response";
import type { UploadDestinationSetting } from "./upload-destination-settings";

const patchSchema = z.object({ destinationId: z.string().uuid(), uploadEnabled: z.boolean() }).strict();

function error(code: string, message: string, status: number) {
  return protectedJson({ error: { code, message } }, status);
}

function isActiveAdmin(authorization: AuthorizationResult) {
  return authorization.kind === "authorized" && authorization.user.status === "ACTIVE" && authorization.user.role === "ADMIN";
}

function requiresJson(request: Request) {
  return request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() === "application/json";
}

async function readJson(request: Request): Promise<{ data: unknown } | { response: Response }> {
  try { return { data: await request.json() }; }
  catch { return { response: error("VALIDATION_ERROR", "The JSON request body is invalid.", 400) }; }
}

export type UploadDestinationSettingsApiDependencies = {
  getAuthorization: () => Promise<AuthorizationResult>;
  listSettings: () => Promise<UploadDestinationSetting[]>;
  setEnabled: (destinationId: string, uploadEnabled: boolean) => Promise<UploadDestinationSetting | null>;
};

async function requireAdmin(getAuthorization: () => Promise<AuthorizationResult>): Promise<Response | null> {
  const authorization = await getAuthorization();
  if (authorization.kind === "unauthenticated") return error("UNAUTHORIZED", "Sign in is required.", 401);
  if (!isActiveAdmin(authorization)) return error("FORBIDDEN", "Active administrator access is required.", 403);
  return null;
}

export function createUploadDestinationSettingsListHandler(dependencies: UploadDestinationSettingsApiDependencies) {
  return async function GET() {
    const authorizationError = await requireAdmin(dependencies.getAuthorization);
    if (authorizationError) return authorizationError;
    try { return protectedJson({ destinations: await dependencies.listSettings() }); }
    catch { return error("REGISTRY_ERROR", "Upload settings are temporarily unavailable.", 500); }
  };
}

export function createUploadDestinationSettingsPatchHandler(dependencies: UploadDestinationSettingsApiDependencies) {
  return async function PATCH(request: Request) {
    const authorizationError = await requireAdmin(dependencies.getAuthorization);
    if (authorizationError) return authorizationError;
    if (!isSameOrigin(request)) return error("FORBIDDEN", "The request origin is not allowed.", 403);
    if (!requiresJson(request)) return error("UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.", 415);
    const body = await readJson(request);
    if ("response" in body) return body.response;
    const parsed = patchSchema.safeParse(body.data);
    if (!parsed.success) return error("VALIDATION_ERROR", "The upload setting request is invalid.", 400);
    try {
      const destination = await dependencies.setEnabled(parsed.data.destinationId, parsed.data.uploadEnabled);
      if (!destination) return error("DESTINATION_UNAVAILABLE", "The upload destination is unavailable.", 404);
      return protectedJson({ destination });
    } catch {
      return error("REGISTRY_ERROR", "Upload settings are temporarily unavailable.", 500);
    }
  };
}
