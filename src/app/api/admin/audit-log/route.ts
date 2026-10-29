import {
  createAuditRepository,
  createLazyAuditRepository,
  createListAuditLogsHandler,
} from "@/lib/audit/audit-log";
import { getAuthorization } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const repository = createLazyAuditRepository(() =>
  createAuditRepository(createAdminClient()),
);

export const GET = createListAuditLogsHandler({
  getAuthorization,
  repository,
});
