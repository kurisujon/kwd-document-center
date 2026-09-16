import { getAuthorization } from "@/lib/auth/server";
import { createDownloadDocumentHandler } from "@/lib/documents/file-api";
import { isDocumentId } from "@/lib/documents/query";
import { getDocumentById } from "@/lib/documents/repository";
import { createDriveService } from "@/lib/google/drive";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export const GET = createDownloadDocumentHandler({
  getAuthorization,
  isDocumentId,
  getDocument: async (documentId) => getDocumentById(await createClient(), documentId),
  drive: createDriveService(),
});
