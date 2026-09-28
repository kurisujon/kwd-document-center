import { getAuthorization } from "@/lib/auth/server";
import { createDriveService } from "@/lib/google/drive";
import { createDriveVerifyHandler } from "@/lib/google/drive-verify";

export const runtime = "nodejs";

export const GET = createDriveVerifyHandler({ getAuthorization, createDriveService });
