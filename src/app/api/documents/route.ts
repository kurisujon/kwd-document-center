import { getAuthorization } from "@/lib/auth/server";
import { createListDocumentsHandler } from "@/lib/documents/api";
import { parseDocumentListQuery } from "@/lib/documents/query";
import { listDocuments } from "@/lib/documents/repository";
import { createClient } from "@/lib/supabase/server";

export const GET = createListDocumentsHandler({
  getAuthorization,
  parseListQuery: parseDocumentListQuery,
  listDocuments: async (query) => listDocuments(await createClient(), query),
});
