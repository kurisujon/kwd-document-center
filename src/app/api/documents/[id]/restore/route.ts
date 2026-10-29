import { getAuthorization } from "@/lib/auth/server";
import { createRestoreDocumentHandler } from "@/lib/documents/deletion-api";
import { restoreDocument } from "@/lib/documents/delete-service";
import { createDeletionRepository } from "@/lib/documents/deletion-repository";
import { isDocumentId } from "@/lib/documents/query";
import { createDriveService } from "@/lib/google/drive";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export const POST = createRestoreDocumentHandler({
  getAuthorization,
  isDocumentId,
  restoreDocument: ({ documentId, actor }) =>
    restoreDocument({
      documentId,
      actor,
      repository: createDeletionRepository(createAdminClient()),
      drive: createDriveService(),
    }),
});
