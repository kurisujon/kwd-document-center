import { createAuditRepository, createLazyAuditRepository } from "@/lib/audit/audit-log";
import { getAuthorization } from "@/lib/auth/server";
import { createDownloadDocumentHandler } from "@/lib/documents/file-api";
import { isDocumentId } from "@/lib/documents/query";
import { getDocumentById } from "@/lib/documents/repository";
import { createDriveService } from "@/lib/google/drive";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const auditRepository = createLazyAuditRepository(() =>
  createAuditRepository(createAdminClient()),
);

export const GET = createDownloadDocumentHandler({
  getAuthorization,
  isDocumentId,
  getDocument: async (documentId) => getDocumentById(await createClient(), documentId),
  drive: createDriveService(),
  recordAccessAudit: (actorId, documentId, action) =>
    auditRepository.recordDocumentAccessAudit(actorId, documentId, action),
});
