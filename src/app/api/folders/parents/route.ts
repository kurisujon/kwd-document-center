import { getAuthorization } from "@/lib/auth/server";
import { getDepartmentConfig } from "@/lib/documents/department-config";
import { createHierarchyParentOptionsHandler } from "@/lib/documents/hierarchy-parents-api";
import { createHierarchyRepository } from "@/lib/documents/hierarchy-repository";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export const GET = createHierarchyParentOptionsHandler({
  getAuthorization,
  getAdminDepartment: () => getDepartmentConfig("ADMIN"),
  listActiveHierarchyFolders: (options) => createHierarchyRepository(createAdminClient()).listActiveHierarchyFolders(options),
});
