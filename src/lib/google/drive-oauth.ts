import { randomBytes, timingSafeEqual } from "node:crypto";
import { google } from "googleapis";
import { DriveServiceError } from "./drive-types";

export const driveOAuthScope = "https://www.googleapis.com/auth/drive.file";
export const driveOAuthStateCookie = "kwd_drive_oauth_state";
export const driveOAuthStateMaxAgeSeconds = 10 * 60;

export interface DriveOAuthConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string | null;
}

export interface DriveOAuthExchange {
  refreshToken: string;
  drive: ReturnType<typeof google.drive>;
}

export function getDriveOAuthConfig(requireRefreshToken = false): DriveOAuthConfig {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN ?? null;

  if (!clientId || !clientSecret || (requireRefreshToken && !refreshToken)) {
    throw new DriveServiceError("PROVIDER");
  }

  return { clientId, clientSecret, refreshToken };
}

export function createDriveOAuthClient(redirectUri?: string) {
  const { clientId, clientSecret } = getDriveOAuthConfig();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function createAuthenticatedDriveClient(credentials: { access_token?: string | null; refresh_token?: string | null; expiry_date?: number | null }) {
  const auth = createDriveOAuthClient();
  auth.setCredentials(credentials);
  return google.drive({ version: "v3", auth });
}

export function generateDriveOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export function matchesDriveOAuthState(expected: string | undefined, received: string | null): boolean {
  if (!expected || !received) return false;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
}

export function getDriveOAuthRedirectUri(requestUrl: string): string {
  return new URL("/api/admin/drive-setup/callback", requestUrl).toString();
}

export function getDriveAuthorizationUrl(redirectUri: string, state: string): string {
  const client = createDriveOAuthClient(redirectUri);
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [driveOAuthScope],
    state,
  });
}

export async function exchangeDriveOAuthCode(code: string, redirectUri: string): Promise<DriveOAuthExchange | null> {
  const client = createDriveOAuthClient(redirectUri);
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) return null;
  return { refreshToken: tokens.refresh_token, drive: google.drive({ version: "v3", auth: client }) };
}
