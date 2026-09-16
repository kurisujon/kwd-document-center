import { getAuthorization } from "@/lib/auth/server";
import { createListDocumentsHandler } from "@/lib/documents/api";
import { createUploadDocumentHandler } from "@/lib/documents/file-api";
import { parseDocumentListQuery } from "@/lib/documents/query";
import { listDocuments } from "@/lib/documents/repository";
import { createUploadAttemptRepository } from "@/lib/documents/upload-repository";
import { uploadAdminDocument } from "@/lib/documents/upload-service";
import { createDriveService } from "@/lib/google/drive";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export const GET = createListDocumentsHandler({
  getAuthorization,
  parseListQuery: parseDocumentListQuery,
  listDocuments: async (query) => listDocuments(await createClient(), query),
});

export const POST = createUploadDocumentHandler({
  getAuthorization,
  uploadDocument: async ({ upload, user }) => uploadAdminDocument({
    upload,
    user,
    repository: createUploadAttemptRepository(createAdminClient()),
    drive: createDriveService(),
  }),
});
