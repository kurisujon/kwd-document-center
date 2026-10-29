import { getAuthorization } from "@/lib/auth/server";
import { createListTrashedDocumentsHandler } from "@/lib/documents/deletion-api";
import { listTrashedDocuments } from "@/lib/documents/delete-service";
import { createDeletionRepository } from "@/lib/documents/deletion-repository";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export const GET = createListTrashedDocumentsHandler({
  getAuthorization,
  listTrashedDocuments: ({ actor }) =>
    listTrashedDocuments({
      actor,
      repository: createDeletionRepository(createAdminClient()),
    }),
});
