import { getAuthorization } from "@/lib/auth/server";
import { createPurgeDocumentHandler } from "@/lib/documents/deletion-api";
import { purgeDocument } from "@/lib/documents/delete-service";
import { createDeletionRepository } from "@/lib/documents/deletion-repository";
import { isDocumentId } from "@/lib/documents/query";
import { createDriveService } from "@/lib/google/drive";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export const POST = createPurgeDocumentHandler({
  getAuthorization,
  isDocumentId,
  purgeDocument: ({ documentId, actor, reason }) =>
    purgeDocument({
      documentId,
      actor,
      reason,
      repository: createDeletionRepository(createAdminClient()),
      drive: createDriveService(),
    }),
});
