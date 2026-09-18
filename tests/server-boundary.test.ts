import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const credentialBearingModules = [
  "src/lib/supabase/admin.ts",
  "src/lib/google/drive.ts",
] as const;

const clientEntryPoints = [
  "src/components/app-shell/navigation.tsx",
  "src/components/app-shell/sign-out-button.tsx",
  "src/components/auth/login-button.tsx",
  "src/components/documents/admin-upload-form.tsx",
  "src/components/users/user-management.tsx",
] as const;

test("credential-bearing client factories retain server-only import guards", async () => {
  for (const modulePath of credentialBearingModules) {
    const source = await readFile(modulePath, "utf8");
    assert.match(source, /^import "server-only";/, modulePath);
  }
});

test("client entry points do not directly reference privileged boundaries or private environment variables", async () => {
  const forbiddenImports = /(?:supabase\/(?:admin|server)|auth\/server|documents\/(?:file-api|upload-repository|upload-service)|google\/drive(?:-oauth|-root|-setup)?|users\/(?:api|repository))/;
  const privateEnvironment = /process\.env\.(?:SUPABASE_SERVICE_ROLE_KEY|GOOGLE_DRIVE_CLIENT_SECRET|GOOGLE_DRIVE_REFRESH_TOKEN|KWD_[A-Z0-9_]+|PHASE4_[A-Z0-9_]+)/;

  for (const modulePath of clientEntryPoints) {
    const source = await readFile(modulePath, "utf8");
    assert.match(source, /^"use client";/, modulePath);
    assert.doesNotMatch(source, forbiddenImports, modulePath);
    assert.doesNotMatch(source, privateEnvironment, modulePath);
  }
});
