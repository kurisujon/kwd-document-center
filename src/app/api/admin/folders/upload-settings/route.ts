import { getAuthorization } from "@/lib/auth/server";
import { createHierarchyRepository } from "@/lib/documents/hierarchy-repository";
import { createUploadDestinationSettingsListHandler, createUploadDestinationSettingsPatchHandler } from "@/lib/documents/upload-destination-settings-api";
import { listUploadDestinationSettings, setUploadDestinationEnabled } from "@/lib/documents/upload-destination-settings";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function repository() {
  return createHierarchyRepository(createAdminClient());
}

const dependencies = {
  getAuthorization,
  listSettings: () => listUploadDestinationSettings(repository()),
  setEnabled: (destinationId: string, uploadEnabled: boolean) => setUploadDestinationEnabled(destinationId, uploadEnabled, repository()),
};

export const GET = createUploadDestinationSettingsListHandler(dependencies);
export const PATCH = createUploadDestinationSettingsPatchHandler(dependencies);
