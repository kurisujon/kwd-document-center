import { createDriveAuthorizeHandler } from "@/lib/google/drive-setup";

export const runtime = "nodejs";

export const GET = createDriveAuthorizeHandler();
