import { createDriveRecoveryAuthorizeHandler } from "@/lib/google/drive-recovery";

export const runtime = "nodejs";

export const GET = createDriveRecoveryAuthorizeHandler();
