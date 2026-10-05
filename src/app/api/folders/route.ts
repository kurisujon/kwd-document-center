import { getAuthorization } from "@/lib/auth/server";
import { createDocumentFolder, createFolderHandler } from "@/lib/documents/folder-api";
import { createFolderRepository } from "@/lib/documents/folder-repository";
import { validateFolderRequest } from "@/lib/documents/folder-validation";
import { createFoldersPostHandler } from "@/lib/documents/hierarchy-create-api";
import { createHierarchyRepository } from "@/lib/documents/hierarchy-repository";
import { createHierarchyFolderInternal } from "@/lib/documents/hierarchy-service";
import { getDepartmentConfig, resolveDepartmentDriveRoot } from "@/lib/documents/department-config";
import { getExplicitAdminDriveFolderId } from "@/lib/documents/drive-config";
import { createDriveFolderService } from "@/lib/google/drive-folders";
import { createAdminClient } from "@/lib/supabase/admin";

const legacyPost = createFolderHandler({
  getAuthorization,
  validate: validateFolderRequest,
  resolveParent: (input) => getExplicitAdminDriveFolderId(input.documentType, input.filingYear, input.filingSubcategory),
  create: (input) => createDocumentFolder({ ...input, repository: createFolderRepository(createAdminClient()), drive: createDriveFolderService() }),
});

export const POST = createFoldersPostHandler({
  getAuthorization,
  legacyPost,
  createHierarchyFolderInternal: (input) => {
    const repository = createHierarchyRepository(createAdminClient());
    const provider = createDriveFolderService();
    return createHierarchyFolderInternal(input, {
      claim: { repository, departments: { getDepartmentConfig, resolveDepartmentDriveRoot } },
      repository,
      provider,
    });
  },
});
