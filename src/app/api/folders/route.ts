import { getAuthorization } from "@/lib/auth/server";
import { createDocumentFolder, createFolderHandler } from "@/lib/documents/folder-api";
import { createFolderRepository } from "@/lib/documents/folder-repository";
import { validateFolderRequest } from "@/lib/documents/folder-validation";
import { getExplicitAdminDriveFolderId } from "@/lib/documents/drive-config";
import { createDriveFolderService } from "@/lib/google/drive-folders";
import { createAdminClient } from "@/lib/supabase/admin";

export const POST = createFolderHandler({
  getAuthorization,
  validate: validateFolderRequest,
  resolveParent: (input) => getExplicitAdminDriveFolderId(input.documentType, input.filingYear, input.filingSubcategory),
  create: (input) => createDocumentFolder({ ...input, repository: createFolderRepository(createAdminClient()), drive: createDriveFolderService() }),
});
