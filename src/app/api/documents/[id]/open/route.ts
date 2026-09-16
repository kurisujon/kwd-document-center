import { getAuthorization } from "@/lib/auth/server";
import { createOpenDocumentHandler } from "@/lib/documents/file-api";
import { isDocumentId } from "@/lib/documents/query";
import { getDocumentById } from "@/lib/documents/repository";
import { createDriveService } from "@/lib/google/drive";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export const GET = createOpenDocumentHandler({
  getAuthorization,
  isDocumentId,
  getDocument: async (documentId) => getDocumentById(await createClient(), documentId),
  drive: createDriveService(),
});
