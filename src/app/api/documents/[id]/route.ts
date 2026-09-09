import { getAuthorization } from "@/lib/auth/server";
import { createGetDocumentHandler } from "@/lib/documents/api";
import { isDocumentId } from "@/lib/documents/query";
import { getDocumentById } from "@/lib/documents/repository";
import { createClient } from "@/lib/supabase/server";

export const GET = createGetDocumentHandler({
  getAuthorization,
  isDocumentId,
  getDocumentById: async (documentId) => getDocumentById(await createClient(), documentId),
});
