import type { AuthorizationResult } from "../auth/types";
import { protectedJson } from "../http/response";
import { DriveServiceError, type DriveFileMetadata, type DriveService } from "./drive-types";

const folderMimeType = "application/vnd.google-apps.folder";

const verificationTargets = [
  { key: "production-root", expectedId: "192ocZvz5MS87jlJ5CiU_Ged3btMnT55_", expectedName: "KWD DOCUMENT CENTER" },
  { key: "admin-documents", expectedId: "1P2hdxEHHJ_a30jgctwIGgDZGM2DtVi8f", expectedName: "ADMIN DOCUMENTS" },
  { key: "admin-2026-bac-agendas", expectedId: "1yT5VGngCc_PlFJcFTKohT7elEYeCWlBh", expectedName: "AGENDA" },
  { key: "admin-2026-attendance-dtr-summary", expectedId: "1T4YtlO64H7MVGp_SfazS39XUvg0fPPDn", expectedName: "DTR SUMMARY" },
  { key: "admin-2026-memorandum", expectedId: "1mDjbYwlBCTSfgB4zDgGl2MkS8ukWnTG7", expectedName: "MEMORANDUM" },
  { key: "admin-reference-templates", expectedId: "1fvXkXnConVoiU0ERGQJxlWgxHctSAmse", expectedName: "REFERENCE & TEMPLATES" },
] as const;

type VerificationFailure = "NOT_FOUND" | "PERMISSION" | "PROVIDER" | "TRANSIENT" | "MISMATCH";

type VerificationCheck = {
  key: string;
  expectedId: string;
  expectedName: string;
  actualId: string | null;
  actualName: string | null;
  mimeType: string | null;
  trashed: boolean | null;
  pass: boolean;
  failure?: VerificationFailure;
};

function authorizationError(authorization: Exclude<AuthorizationResult, { kind: "authorized" }>) {
  if (authorization.kind === "unauthenticated") {
    return protectedJson({ error: { code: "UNAUTHORIZED", message: "Sign in is required." } }, 401);
  }
  return protectedJson({ error: { code: "FORBIDDEN", message: "Administrator access is required." } }, 403);
}

function failureFor(error: unknown): VerificationFailure {
  if (!(error instanceof DriveServiceError)) return "PROVIDER";
  switch (error.kind) {
    case "NOT_FOUND": return "NOT_FOUND";
    case "FORBIDDEN": return "PERMISSION";
    case "TRANSIENT": return "TRANSIENT";
    default: return "PROVIDER";
  }
}

function checkMetadata(target: (typeof verificationTargets)[number], metadata: DriveFileMetadata): VerificationCheck {
  const pass = metadata.id === target.expectedId
    && metadata.mimeType === folderMimeType
    && metadata.trashed === false
    && metadata.name === target.expectedName;
  return {
    key: target.key,
    expectedId: target.expectedId,
    expectedName: target.expectedName,
    actualId: metadata.id,
    actualName: metadata.name,
    mimeType: metadata.mimeType,
    trashed: metadata.trashed,
    pass,
    ...(pass ? {} : { failure: "MISMATCH" as const }),
  };
}

export type DriveVerifyDependencies = {
  getAuthorization: () => Promise<AuthorizationResult>;
  createDriveService: () => Pick<DriveService, "getMetadata">;
};

export function createDriveVerifyHandler(dependencies: DriveVerifyDependencies) {
  return async function GET(_request: Request): Promise<Response> {
    void _request;
    const authorization = await dependencies.getAuthorization();
    if (authorization.kind !== "authorized") return authorizationError(authorization);
    if (authorization.user.role !== "ADMIN") {
      return protectedJson({ error: { code: "FORBIDDEN", message: "Administrator access is required." } }, 403);
    }

    const drive = dependencies.createDriveService();
    const checks = await Promise.all(verificationTargets.map(async (target): Promise<VerificationCheck> => {
      try {
        return checkMetadata(target, await drive.getMetadata(target.expectedId));
      } catch (error) {
        return {
          key: target.key,
          expectedId: target.expectedId,
          expectedName: target.expectedName,
          actualId: null,
          actualName: null,
          mimeType: null,
          trashed: null,
          pass: false,
          failure: failureFor(error),
        };
      }
    }));

    return protectedJson({ ok: checks.every((check) => check.pass), checks });
  };
}
