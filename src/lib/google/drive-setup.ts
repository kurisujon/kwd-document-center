import { NextResponse, type NextRequest } from "next/server";
import { getAuthorization } from "../auth/server";
import { hasMinimumRole } from "../auth/permissions";
import type { AuthorizationResult } from "../auth/types";
import {
  driveOAuthStateCookie,
  driveOAuthStateMaxAgeSeconds,
  exchangeDriveOAuthCode,
  generateDriveOAuthState,
  getDriveAuthorizationUrl,
  getDriveOAuthRedirectUri,
  matchesDriveOAuthState,
} from "./drive-oauth";
import { ensureRootDriveFolder } from "./drive-root";
import { logOperationalFailure } from "../observability/log";

type AuthorizationDependency = () => Promise<AuthorizationResult>;
type ExchangeDependency = (code: string, redirectUri: string) => ReturnType<typeof exchangeDriveOAuthCode>;
type RootFolderDependency = (drive: Parameters<typeof ensureRootDriveFolder>[0]) => ReturnType<typeof ensureRootDriveFolder>;

function protectSetupResponse(response: NextResponse): NextResponse {
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set("x-content-type-options", "nosniff");
  return response;
}

function authorizationFailure(authorization: AuthorizationResult): NextResponse | null {
  if (authorization.kind === "authorized" && hasMinimumRole(authorization.user.role, "ADMIN")) return null;
  if (authorization.kind === "unauthenticated") {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Sign in is required." } }, { status: 401 });
  }
  return NextResponse.json({ error: { code: "FORBIDDEN", message: "Administrator access is required." } }, { status: 403 });
}

function clearStateCookie(response: NextResponse): NextResponse {
  response.cookies.set(driveOAuthStateCookie, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/admin/drive-setup",
    maxAge: 0,
  });
  return response;
}

export function createDriveAuthorizeHandler(dependencies: { getAuthorization?: AuthorizationDependency } = {}) {
  const authorize = dependencies.getAuthorization ?? getAuthorization;
  return async function driveAuthorize(request: NextRequest): Promise<NextResponse> {
    const authorization = await authorize();
    const failure = authorizationFailure(authorization);
    if (failure) return protectSetupResponse(failure);

    try {
      const state = generateDriveOAuthState();
      const redirectUri = getDriveOAuthRedirectUri(request.url);
      const response = protectSetupResponse(NextResponse.redirect(getDriveAuthorizationUrl(redirectUri, state)));
      response.cookies.set(driveOAuthStateCookie, state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/api/admin/drive-setup",
        maxAge: driveOAuthStateMaxAgeSeconds,
      });
      return response;
    } catch {
      logOperationalFailure({ operation: "drive.oauth.authorize", outcome: "failure", category: "DRIVE_OAUTH_CONFIGURATION_FAILED", status: 503 });
      return protectSetupResponse(NextResponse.json({ error: { code: "CONFIGURATION_ERROR", message: "Drive OAuth is not configured." } }, { status: 503 }));
    }
  };
}

export function createDriveCallbackHandler(dependencies: { getAuthorization?: AuthorizationDependency; exchangeCode?: ExchangeDependency; ensureRootFolder?: RootFolderDependency } = {}) {
  const authorize = dependencies.getAuthorization ?? getAuthorization;
  const exchangeCode = dependencies.exchangeCode ?? exchangeDriveOAuthCode;
  const ensureRootFolder = dependencies.ensureRootFolder ?? ensureRootDriveFolder;
  return async function driveCallback(request: NextRequest): Promise<NextResponse> {
    const authorization = await authorize();
    const failure = authorizationFailure(authorization);
    if (failure) return clearStateCookie(protectSetupResponse(failure));

    const url = new URL(request.url);
    const responseForError = (message: string, status: number) => clearStateCookie(protectSetupResponse(NextResponse.json({ error: { code: "DRIVE_SETUP_ERROR", message } }, { status })));
    const state = url.searchParams.get("state");
    if (!matchesDriveOAuthState(request.cookies.get(driveOAuthStateCookie)?.value, state)) {
      return responseForError("The Drive OAuth setup request is invalid or expired.", 400);
    }

    const error = url.searchParams.get("error");
    if (error) return responseForError("Google Drive authorization was not completed.", 400);

    const code = url.searchParams.get("code");
    if (!code) return responseForError("Google Drive authorization did not return a code.", 400);

    try {
      const exchange = await exchangeCode(code, getDriveOAuthRedirectUri(request.url));
      if (!exchange) return responseForError("Google did not return a refresh token. Retry setup with consent.", 502);
      const rootFolderId = await ensureRootFolder(exchange.drive);

      const response = protectSetupResponse(new NextResponse(
        "Drive authorization complete. Copy the value below into the Vercel environment variable GOOGLE_DRIVE_REFRESH_TOKEN, then close this page.\n\n"
          + `GOOGLE_DRIVE_REFRESH_TOKEN=${exchange.refreshToken}\n`
          + `GOOGLE_DRIVE_ROOT_FOLDER_ID=${rootFolderId}\n`,
        {
          status: 200,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
            "pragma": "no-cache",
          },
        },
      ));
      return clearStateCookie(response);
    } catch {
      logOperationalFailure({ operation: "drive.oauth.callback", outcome: "failure", category: "DRIVE_OAUTH_SETUP_FAILED", status: 502 });
      return responseForError("Drive OAuth setup could not be completed. Please retry.", 502);
    }
  };
}
