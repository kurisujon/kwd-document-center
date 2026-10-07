import { hasMinimumRole } from "../auth/permissions";
import type { AuthorizationResult } from "../auth/types";
import { protectedJson } from "../http/response";
import type { HierarchyFolderRecord } from "./hierarchy-repository";

const uploadableKinds = ["CATEGORY", "SUBCATEGORY", "WORKING_FOLDER"] as const;
type UploadableKind = (typeof uploadableKinds)[number];

export type UploadDestination = {
  folderId: string;
  departmentKey: "ADMIN";
  hierarchyKind: UploadableKind;
  filingYear: number;
  category: string;
  subcategory: string | null;
  logicalKey: string;
  driveFolderId: string;
};

export type UploadDestinationOption = {
  destinationId: string;
  kind: UploadableKind;
  filingYear: number;
  category: string;
  subcategory: string | null;
  label: string;
};

export type UploadDestinationErrorCode = "NOT_FOUND" | "UNSUPPORTED_DEPARTMENT" | "UNSUPPORTED_KIND" | "UPLOAD_DISABLED" | "MALFORMED_DESTINATION";

export class UploadDestinationError extends Error {
  constructor(readonly code: UploadDestinationErrorCode) {
    super("Upload destination is unavailable.");
  }
}

export type UploadDestinationRepository = {
  getHierarchyFolderById?(id: string): Promise<HierarchyFolderRecord | null>;
  getActiveHierarchyFolderById(id: string): Promise<HierarchyFolderRecord | null>;
  listActiveHierarchyFolders(options: { departmentKey: string; kinds: UploadableKind[] }): Promise<HierarchyFolderRecord[]>;
};

export type FolderUploadDestinationContext = Omit<UploadDestination, "logicalKey">;

export function resolveFolderUploadDestinationContext(record: HierarchyFolderRecord): FolderUploadDestinationContext {
  if (record.departmentKey !== "ADMIN" || !isUploadableKind(record.hierarchyKind) || !record.driveFolderId || record.filingYear === null || !record.category || !record.logicalKey) throw new UploadDestinationError("MALFORMED_DESTINATION");
  if (record.hierarchyKind === "CATEGORY" && record.subcategory !== null) throw new UploadDestinationError("MALFORMED_DESTINATION");
  if (record.hierarchyKind === "SUBCATEGORY" && !record.subcategory) throw new UploadDestinationError("MALFORMED_DESTINATION");
  return { folderId: record.id, departmentKey: "ADMIN", hierarchyKind: record.hierarchyKind, filingYear: record.filingYear, category: record.category, subcategory: record.hierarchyKind === "CATEGORY" ? null : record.subcategory, driveFolderId: record.driveFolderId };
}

function isUploadableKind(value: string | null): value is UploadableKind {
  return uploadableKinds.includes(value as UploadableKind);
}

export function validateUploadDestinationRecord(record: HierarchyFolderRecord, options: { requireUploadEnabled: boolean; requireDriveFolderId: boolean }): UploadDestination {
  if (record.status !== "ACTIVE") throw new UploadDestinationError("NOT_FOUND");
  if (record.departmentKey !== "ADMIN") throw new UploadDestinationError("UNSUPPORTED_DEPARTMENT");
  if (!isUploadableKind(record.hierarchyKind)) throw new UploadDestinationError("UNSUPPORTED_KIND");
  if (options.requireUploadEnabled && !record.uploadEnabled) throw new UploadDestinationError("UPLOAD_DISABLED");
  if ((options.requireDriveFolderId && !record.driveFolderId) || !record.logicalKey || record.filingYear === null || !record.category) throw new UploadDestinationError("MALFORMED_DESTINATION");
  if (record.hierarchyKind === "CATEGORY" && record.subcategory !== null) throw new UploadDestinationError("MALFORMED_DESTINATION");
  if (record.hierarchyKind === "SUBCATEGORY" && !record.subcategory) throw new UploadDestinationError("MALFORMED_DESTINATION");
  return { folderId: record.id, departmentKey: "ADMIN", hierarchyKind: record.hierarchyKind, filingYear: record.filingYear, category: record.category, subcategory: record.hierarchyKind === "CATEGORY" ? null : record.subcategory, logicalKey: record.logicalKey, driveFolderId: record.driveFolderId ?? "" };
}

export async function resolveUploadDestination(folderId: string, repository: UploadDestinationRepository): Promise<UploadDestination> {
  const record = await repository.getActiveHierarchyFolderById(folderId);
  if (!record) throw new UploadDestinationError("NOT_FOUND");
  return validateUploadDestinationRecord(record, { requireUploadEnabled: true, requireDriveFolderId: true });
}

function toOption(destination: UploadDestination): UploadDestinationOption {
  const label = [destination.filingYear, destination.category, destination.subcategory].filter(Boolean).join(" / ");
  return { destinationId: destination.folderId, kind: destination.hierarchyKind, filingYear: destination.filingYear, category: destination.category, subcategory: destination.subcategory, label };
}

export async function listUploadDestinations(repository: UploadDestinationRepository): Promise<UploadDestinationOption[]> {
  const records = await repository.listActiveHierarchyFolders({ departmentKey: "ADMIN", kinds: [...uploadableKinds] });
  const destinations = records.flatMap((record) => {
    try { return [validateUploadDestinationRecord(record, { requireUploadEnabled: true, requireDriveFolderId: true })]; }
    catch { return []; }
  });
  return destinations.sort((left, right) => right.filingYear - left.filingYear || left.category.localeCompare(right.category) || (left.subcategory ?? "").localeCompare(right.subcategory ?? "") || left.logicalKey.localeCompare(right.logicalKey)).map(toOption);
}

function error(code: string, message: string, status: number) {
  return protectedJson({ error: { code, message } }, status);
}

export function createUploadDestinationListHandler(dependencies: { getAuthorization: () => Promise<AuthorizationResult>; listDestinations: () => Promise<UploadDestinationOption[]> }) {
  return async function GET() {
    const authorization = await dependencies.getAuthorization();
    if (authorization.kind === "unauthenticated") return error("UNAUTHORIZED", "Sign in is required.", 401);
    if (authorization.kind !== "authorized" || authorization.user.status !== "ACTIVE" || !hasMinimumRole(authorization.user.role, "STAFF")) return error("FORBIDDEN", "Staff access is required to view upload destinations.", 403);
    try {
      return protectedJson({ destinations: await dependencies.listDestinations() });
    } catch {
      return error("REGISTRY_ERROR", "Upload destinations are temporarily unavailable.", 500);
    }
  };
}
