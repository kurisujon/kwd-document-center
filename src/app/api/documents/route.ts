import { getAuthorization } from "@/lib/auth/server";
import { createListDocumentsHandler } from "@/lib/documents/api";
import { createUploadDocumentHandler } from "@/lib/documents/file-api";
import { parseDocumentListQuery } from "@/lib/documents/query";
import { listDocuments } from "@/lib/documents/repository";
import { createFolderUploadAttemptRepository, createUploadAttemptRepository } from "@/lib/documents/upload-repository";
import { createHierarchyRepository } from "@/lib/documents/hierarchy-repository";
import { uploadAdminDocument, uploadFolderDocument } from "@/lib/documents/upload-service";
import { createDriveService } from "@/lib/google/drive";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export const GET = createListDocumentsHandler({
  getAuthorization,
  parseListQuery: parseDocumentListQuery,
  listDocuments: async (query, viewer) => listDocuments(await createClient(), query, viewer),
});

export const POST = createUploadDocumentHandler({
  getAuthorization,
  uploadDocument: async ({ upload, user }) => uploadAdminDocument({
    upload,
    user,
    repository: createUploadAttemptRepository(createAdminClient()),
    drive: createDriveService(),
  }),
  uploadFolderDocument: async ({ upload, user }) => {
    const client = createAdminClient();
    return uploadFolderDocument({
      upload,
      user,
      attempts: createUploadAttemptRepository(client),
      folderAttempts: createFolderUploadAttemptRepository(client),
      getDestination: (folderId) => createHierarchyRepository(client).getHierarchyFolderById(folderId),
      drive: createDriveService(),
    });
  },
});
