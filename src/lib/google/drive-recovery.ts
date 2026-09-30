import { NextResponse, type NextRequest } from "next/server";
import { getAuthorization } from "../auth/server";
import type { AuthorizationResult } from "../auth/types";
import { logOperationalFailure } from "../observability/log";
import { classifyDriveError } from "./drive-types";
import { createAuthenticatedDriveClient, createDriveOAuthClient, driveOAuthScope, generateDriveOAuthState, matchesDriveOAuthState } from "./drive-oauth";

export const driveRecoveryStateCookie = "kwd_drive_recovery_state";
export const driveRecoveryStateMaxAgeSeconds = 10 * 60;
export const driveRecoveryRedirectUri = "https://kwd-document-center.vercel.app/api/admin/drive-recovery/callback";

const approvedFolders = [
  { key: "production-root", label: "KWD DOCUMENT CENTER", id: "192ocZvz5MS87jlJ5CiU_Ged3btMnT55_" },
  { key: "admin-documents", label: "ADMIN DOCUMENTS", id: "1P2hdxEHHJ_a30jgctwIGgDZGM2DtVi8f" },
  { key: "admin-2026-bacti-test", label: "ADMIN|2026|BACTI TEST", id: "1LyJCNs26Z0oLRIhWSVPvC6KmXd0GSuaq" },
  { key: "admin-2026-bac-agendas", label: "ADMIN|2026|BAC|AGENDAS", id: "1yT5VGngCc_PlFJcFTKohT7elEYeCWlBh" },
  { key: "admin-2026-bac-meeting-minutes", label: "ADMIN|2026|BAC|MEETING MINUTES", id: "13IXn9PuW8RLnjEhriII9WbtCnU6PkZO0" },
  { key: "admin-2026-bac-resolutions", label: "ADMIN|2026|BAC|RESOLUTIONS", id: "1S6AHWn1Fm-h96LP3kPmDPZUWX2Oe70Qa" },
  { key: "admin-2026-attendance-regular-casual", label: "ADMIN|2026|ATTENDANCE|REGULAR & CASUAL", id: "1kxB-XjOyjTezYDUxgFbsq8LYaNC3OOTU" },
  { key: "admin-2026-attendance-cos-jo", label: "ADMIN|2026|ATTENDANCE|CONTRACT OF SERVICE & JOB ORDER", id: "1YLFO7oq4mJB9KA9du5Jll-hav2d14UFM" },
  { key: "admin-2026-attendance-dtr-summary", label: "ADMIN|2026|ATTENDANCE|DTR SUMMARY", id: "1T4YtlO64H7MVGp_SfazS39XUvg0fPPDn" },
  { key: "admin-2026-attendance-schedule", label: "ADMIN|2026|ATTENDANCE|SCHEDULE", id: "1N7MLqNfyoAyYsEVENC-G0jTG2qfG8rCE" },
  { key: "admin-2026-board-meeting-minutes", label: "ADMIN|2026|BOARD MEETING MINUTES", id: "1tOl0lIoOtS7-b0H5C58BeEFw4rnQfsPk" },
  { key: "admin-2026-memorandum", label: "ADMIN|2026|MEMORANDUM", id: "1mDjbYwlBCTSfgB4zDgGl2MkS8ukWnTG7" },
  { key: "admin-2026-operations-manual", label: "ADMIN|2026|OPERATIONS MANUAL", id: "13SmHoms2o9iMOHKW9YW3uSHHJVphJJU4" },
  { key: "admin-2026-board-resolution", label: "ADMIN|2026|BOARD RESOLUTION", id: "17uX3k-c3jsshzmt2NcVJZmLTjPpma0jf" },
  { key: "admin-2026-contracts", label: "ADMIN|2026|CONTRACTS", id: "17LIek68dapTXePXTMy36bwO5lNCWdtzF" },
  { key: "admin-reference-templates", label: "ADMIN|REFERENCE & TEMPLATES", id: "1fvXkXnConVoiU0ERGQJxlWgxHctSAmse" },
  { key: "admin-2025-contracts", label: "ADMIN|2025|CONTRACTS", id: "1pkPwtH5erTokHNP-HOW_ITuIhXhMev5J" },
  { key: "admin-2025-hrmo", label: "ADMIN|2025|HRMO", id: "1ZlnOo-UJA6MHWq0yZPfaHbcM855AkP0O" },
] as const;

const approvedFolderIds = new Set<string>(approvedFolders.map(({ id }) => id));

type AuthorizationDependency = () => Promise<AuthorizationResult>;
type RecoveryCredentials = { access_token?: string | null; refresh_token?: string | null; expiry_date?: number | null };
type ExchangeDependency = (code: string, redirectUri: string) => Promise<{ refreshToken: string | null; credentials: RecoveryCredentials }>;
type AuthorizationUrlDependency = (state: string) => string;
type FolderMetadata = { id?: string | null; name?: string | null; mimeType?: string | null; trashed?: boolean | null };
type FolderVerification = { kind: "valid" } | { kind: "access" | "transient" | "failed"; folders: string[] };

function protectedResponse(response: NextResponse): NextResponse {
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

function clearStateCookie(response: NextResponse): NextResponse {
  response.cookies.set(driveRecoveryStateCookie, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/admin/drive-recovery",
    maxAge: 0,
  });
  return response;
}

function responseForError(code: string, message: string, status: number): NextResponse {
  return clearStateCookie(protectedResponse(NextResponse.json({ error: { code, message } }, { status })));
}

function responseForFolderVerification(code: string, message: string, folders: string[], status: number): NextResponse {
  return clearStateCookie(protectedResponse(NextResponse.json({ error: { code, message, folders } }, { status })));
}

function authorizationFailure(authorization: AuthorizationResult): NextResponse | null {
  if (authorization.kind === "authorized" && authorization.user.role === "ADMIN") return null;
  if (authorization.kind === "unauthenticated") {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Sign in is required." } }, { status: 401 });
  }
  return NextResponse.json({ error: { code: "FORBIDDEN", message: "Administrator access is required." } }, { status: 403 });
}

function getRecoveryAuthorizationUrl(state: string): string {
  const url = new URL(createDriveOAuthClient(driveRecoveryRedirectUri).generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [driveOAuthScope],
    state,
  }));
  url.searchParams.set("trigger_onepick", "true");
  url.searchParams.set("allow_multiple", "true");
  url.searchParams.set("allow_folder_selection", "true");
  url.searchParams.set("file_ids", approvedFolders.map(({ id }) => id).join(","));
  return url.toString();
}

async function exchangeRecoveryCode(code: string, redirectUri: string): Promise<{ refreshToken: string | null; credentials: RecoveryCredentials }> {
  const client = createDriveOAuthClient(redirectUri);
  const { tokens } = await client.getToken(code);
  return {
    refreshToken: tokens.refresh_token ?? null,
    credentials: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
    },
  };
}

function selectionResult(pickedFileIds: string | null): { missing: string[] } | { invalid: true } | { valid: true } {
  if (!pickedFileIds) return { missing: approvedFolders.map(({ label }) => label) };
  const selected = pickedFileIds.split(",").filter(Boolean);
  const uniqueSelected = new Set(selected);
  if (selected.length !== uniqueSelected.size || [...uniqueSelected].some((id) => !approvedFolderIds.has(id))) return { invalid: true };
  const missing = approvedFolders.filter(({ id }) => !uniqueSelected.has(id)).map(({ label }) => label);
  return missing.length > 0 ? { missing } : { valid: true };
}

export async function verifyApprovedFolderAccess(
  credentials: RecoveryCredentials,
  dependencies: { getMetadata?: (id: string) => Promise<FolderMetadata> } = {},
): Promise<FolderVerification> {
  const drive = dependencies.getMetadata ? null : createAuthenticatedDriveClient(credentials);
  const getMetadata = dependencies.getMetadata ?? (async (id: string) => {
    const response = await drive!.files.get({
      fileId: id,
      fields: "id,name,mimeType,trashed",
      supportsAllDrives: true,
    });
    return response.data;
  });

  const results = await Promise.all(approvedFolders.map(async (folder) => {
    try {
      const metadata = await getMetadata(folder.id);
      if (metadata.id !== folder.id || metadata.mimeType !== "application/vnd.google-apps.folder" || metadata.trashed !== false) {
        return { label: folder.label, kind: "failed" as const };
      }
      return { label: folder.label, kind: "valid" as const };
    } catch (error) {
      const kind = classifyDriveError(error).kind;
      if (kind === "TRANSIENT") return { label: folder.label, kind: "transient" as const };
      if (kind === "NOT_FOUND" || kind === "FORBIDDEN") return { label: folder.label, kind: "access" as const };
      return { label: folder.label, kind: "failed" as const };
    }
  }));

  for (const kind of ["transient", "failed", "access"] as const) {
    const folders = results.filter((result) => result.kind === kind).map(({ label }) => label);
    if (folders.length > 0) return { kind, folders };
  }
  return { kind: "valid" };
}

export function createDriveRecoveryAuthorizeHandler(dependencies: { getAuthorization?: AuthorizationDependency; getAuthorizationUrl?: AuthorizationUrlDependency } = {}) {
  const authorize = dependencies.getAuthorization ?? getAuthorization;
  const getAuthorizationUrl = dependencies.getAuthorizationUrl ?? getRecoveryAuthorizationUrl;
  return async function GET(_request: NextRequest): Promise<NextResponse> {
    void _request;
    const failure = authorizationFailure(await authorize());
    if (failure) return protectedResponse(failure);
    try {
      const state = generateDriveOAuthState();
      const response = protectedResponse(NextResponse.redirect(getAuthorizationUrl(state)));
      response.cookies.set(driveRecoveryStateCookie, state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/api/admin/drive-recovery",
        maxAge: driveRecoveryStateMaxAgeSeconds,
      });
      return response;
    } catch {
      logOperationalFailure({ operation: "drive.recovery.authorize", outcome: "failure", category: "DRIVE_RECOVERY_CONFIGURATION_FAILED", status: 503 });
      return protectedResponse(NextResponse.json({ error: { code: "CONFIGURATION_ERROR", message: "Drive recovery is not configured." } }, { status: 503 }));
    }
  };
}

export function createDriveRecoveryCallbackHandler(dependencies: { getAuthorization?: AuthorizationDependency; exchangeCode?: ExchangeDependency; verifyFolders?: (credentials: RecoveryCredentials) => Promise<FolderVerification> } = {}) {
  const authorize = dependencies.getAuthorization ?? getAuthorization;
  const exchangeCode = dependencies.exchangeCode ?? exchangeRecoveryCode;
  const verifyFolders = dependencies.verifyFolders ?? verifyApprovedFolderAccess;
  return async function GET(request: NextRequest): Promise<NextResponse> {
    const failure = authorizationFailure(await authorize());
    if (failure) return clearStateCookie(protectedResponse(failure));

    const state = request.nextUrl.searchParams.get("state");
    if (!matchesDriveOAuthState(request.cookies.get(driveRecoveryStateCookie)?.value, state)) {
      return responseForError("INVALID_STATE", "The Drive recovery request is invalid or expired.", 400);
    }
    if (request.nextUrl.searchParams.has("error")) {
      return responseForError("OAUTH_ERROR", "Google Drive authorization was not completed.", 400);
    }
    if (request.nextUrl.searchParams.get("scope") !== driveOAuthScope) {
      return responseForError("INVALID_SCOPE", "Drive recovery did not grant the required scope.", 400);
    }

    const selection = selectionResult(request.nextUrl.searchParams.get("picked_file_ids"));
    if ("invalid" in selection) return responseForError("INVALID_FOLDER_SELECTION", "Drive recovery selection is invalid.", 400);
    if ("missing" in selection) {
      return clearStateCookie(protectedResponse(NextResponse.json({
        error: { code: "INCOMPLETE_FOLDER_SELECTION", message: "Select every approved Production folder before continuing.", missing: selection.missing },
      }, { status: 400 })));
    }

    const code = request.nextUrl.searchParams.get("code");
    if (!code) return responseForError("MISSING_CODE", "Google Drive authorization did not return a code.", 400);

    try {
      const exchange = await exchangeCode(code, driveRecoveryRedirectUri);
      if (!exchange.refreshToken) return responseForError("REFRESH_TOKEN_NOT_RETURNED", "Google did not return a refresh token. Retry recovery with consent.", 502);
      const verification = await verifyFolders(exchange.credentials);
      if (verification.kind === "transient") {
        return responseForFolderVerification("DRIVE_FOLDER_VERIFICATION_UNAVAILABLE", "Drive folder access verification is temporarily unavailable.", verification.folders, 503);
      }
      if (verification.kind === "failed") {
        return responseForFolderVerification("DRIVE_FOLDER_VERIFICATION_FAILED", "Drive folder verification failed.", verification.folders, 502);
      }
      if (verification.kind === "access") {
        return responseForFolderVerification("DRIVE_FOLDER_ACCESS_INCOMPLETE", "Drive access could not be verified for all required folders.", verification.folders, 403);
      }
      const response = protectedResponse(new NextResponse(
        "Drive recovery authorization complete.\n\nDO NOT SCREENSHOT THIS TOKEN\nDO NOT SEND IT IN CHAT\nCOPY IT DIRECTLY INTO THE VERCEL PRODUCTION ENVIRONMENT VARIABLE\n\nGOOGLE_DRIVE_REFRESH_TOKEN=" + exchange.refreshToken + "\n",
        { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'", pragma: "no-cache" } },
      ));
      return clearStateCookie(response);
    } catch {
      logOperationalFailure({ operation: "drive.recovery.callback", outcome: "failure", category: "DRIVE_RECOVERY_TOKEN_EXCHANGE_FAILED", status: 502 });
      return responseForError("TOKEN_EXCHANGE_FAILED", "Drive recovery token exchange could not be completed. Please retry.", 502);
    }
  };
}

export { approvedFolders, getRecoveryAuthorizationUrl };
