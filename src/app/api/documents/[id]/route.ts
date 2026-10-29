import { getAuthorization } from "@/lib/auth/server";
import { createGetDocumentHandler } from "@/lib/documents/api";
import { createConfidentialityRepository, createPatchDocumentConfidentialityHandler } from "@/lib/documents/confidentiality-api";
import { createDeleteDocumentHandler } from "@/lib/documents/deletion-api";
import { deleteDocument } from "@/lib/documents/delete-service";
import { createDeletionRepository } from "@/lib/documents/deletion-repository";
import { isDocumentId } from "@/lib/documents/query";
import { getDocumentById } from "@/lib/documents/repository";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const GET = createGetDocumentHandler({
  getAuthorization,
  isDocumentId,
  getDocumentById: async (documentId, viewer) => getDocumentById(await createClient(), documentId, viewer),
});

export const PATCH = createPatchDocumentConfidentialityHandler({
  getAuthorization,
  isDocumentId,
  setDocumentConfidentiality: ({ documentId, actor, confidential }) =>
    createConfidentialityRepository(createAdminClient()).setConfidential({
      documentId,
      actorId: actor.id,
      confidential,
    }),
});

export const DELETE = createDeleteDocumentHandler({
  getAuthorization,
  isDocumentId,
  deleteDocument: ({ documentId, actor }) => deleteDocument({
    documentId,
    actor,
    repository: createDeletionRepository(createAdminClient()),
  }),
});
