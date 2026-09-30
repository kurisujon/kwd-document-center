import { getAuthorization } from "@/lib/auth/server";
import { createGetDocumentHandler } from "@/lib/documents/api";
import { createDeleteDocumentHandler } from "@/lib/documents/deletion-api";
import { deleteDocument } from "@/lib/documents/delete-service";
import { createDeletionRepository } from "@/lib/documents/deletion-repository";
import { isDocumentId } from "@/lib/documents/query";
import { getDocumentById } from "@/lib/documents/repository";
import { createDriveService } from "@/lib/google/drive";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const GET = createGetDocumentHandler({
  getAuthorization,
  isDocumentId,
  getDocumentById: async (documentId) => getDocumentById(await createClient(), documentId),
});

export const DELETE = createDeleteDocumentHandler({
  getAuthorization,
  isDocumentId,
  deleteDocument: ({ documentId, actor }) => deleteDocument({
    documentId,
    actor,
    repository: createDeletionRepository(createAdminClient()),
    drive: createDriveService(),
  }),
});
