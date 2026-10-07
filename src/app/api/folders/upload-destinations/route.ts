import { getAuthorization } from "@/lib/auth/server";
import { createUploadDestinationListHandler, listUploadDestinations } from "@/lib/documents/upload-destination";
import { createHierarchyRepository } from "@/lib/documents/hierarchy-repository";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export const GET = createUploadDestinationListHandler({
  getAuthorization,
  listDestinations: () => listUploadDestinations(createHierarchyRepository(createAdminClient())),
});
