import { createDriveCallbackHandler } from "@/lib/google/drive-setup";

export const runtime = "nodejs";

export const GET = createDriveCallbackHandler();
