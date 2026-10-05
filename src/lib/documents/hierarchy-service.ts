import type { DepartmentKey } from "./department-config";
import { randomUUID } from "node:crypto";
import type { HierarchyClaimInput, HierarchyClaimResult, HierarchyFolderRecord } from "./hierarchy-repository";
import type { HierarchyKind } from "./hierarchy-validation";
import { adminSubcategories, isAdminCategory, type AdminCategory } from "./admin-categories";
import { normalizeFolderName } from "./folder-validation";

// Dependencies are injected so standalone tsx tests never load server-only configuration.
export type HierarchyRecord = { id: string; status: "ACTIVE" | "CREATING" | "FAILED"; department_key: DepartmentKey | null; hierarchy_kind: HierarchyKind | null; drive_folder_id: string | null; upload_enabled: boolean; logical_key: string | null; source: "STATIC" | "DYNAMIC" | null };
export type HierarchyServiceErrorCode = "INVALID_PARENT" | "INVALID_HIERARCHY" | "DEPARTMENT_UNAVAILABLE" | "PARENT_NOT_FOUND" | "PARENT_NOT_READY" | "PARENT_UNAVAILABLE" | "INVALID_YEAR" | "INVALID_CATEGORY" | "INVALID_SUBCATEGORY" | "INVALID_FOLDER_NAME" | "INVALID_IDEMPOTENCY" | "DUPLICATE_FOLDER" | "CLAIM_UNAVAILABLE" | "DRIVE_ID_RESERVATION_UNAVAILABLE" | "OPERATION_NOT_OWNED" | "PERSIST_UNAVAILABLE" | "PROVIDER_CREATE_FAILED" | "PROVIDER_VERIFY_FAILED" | "PROVIDER_OBJECT_MISMATCH" | "FINALIZE_UNAVAILABLE" | "MARK_FAILED_UNAVAILABLE";
export class HierarchyServiceError extends Error { constructor(readonly code: HierarchyServiceErrorCode) { super("Hierarchy parent is unavailable."); } }
export type HierarchyParentRepository = { getActiveHierarchyFolderById(id: string): Promise<HierarchyFolderRecord | null> };
export type HierarchyDepartmentConfig = { key: DepartmentKey; label: string; enabled: boolean; driveRootId: string | null };
export type HierarchyDepartmentResolver = { getDepartmentConfig(key: DepartmentKey): HierarchyDepartmentConfig; resolveDepartmentDriveRoot(key: DepartmentKey): HierarchyDepartmentConfig };
export type ResolveHierarchyParentInput = { departmentKey: string; parentRef: string; childKind: HierarchyKind };
export type ResolvedHierarchyParent = { type: "DEPARTMENT_ROOT"; departmentKey: "ADMIN"; parentFolderId: null; logicalParentKey: "department:ADMIN"; driveParentId: string } | { type: "REGISTERED_FOLDER"; departmentKey: DepartmentKey; parentFolderId: string; logicalParentKey: string; driveParentId: string; parent: HierarchyFolderRecord };
export type DeriveHierarchyChildMetadataInput = { parent: ResolvedHierarchyParent; kind: HierarchyKind; filingYear?: unknown; category?: unknown; subcategory?: unknown; name?: unknown };
export type DerivedHierarchyChildMetadata = { departmentKey: DepartmentKey; hierarchyKind: HierarchyKind; parentFolderId: string | null; logicalParentKey: string; driveParentId: string; filingYear: number; category: AdminCategory | null; subcategory: string | null; logicalKey: string; name: string; normalizedName: string; source: "DYNAMIC"; uploadEnabled: false };
export type ClaimHierarchyCreationInput = { actorId: string; idempotencyKey: string; departmentKey: string; parentRef: string; kind: HierarchyKind; requestedFilingYear?: unknown; requestedCategory?: unknown; requestedSubcategory?: unknown; requestedName?: unknown };
export type ClaimHierarchyCreationResult = { status: "OWNED"; folderId: string; operationToken: string; driveFolderId: string | null; metadata: DerivedHierarchyChildMetadata } | { status: "ACTIVE_EXISTING" | "IN_PROGRESS"; folderId: string | null; metadata: DerivedHierarchyChildMetadata };
export type HierarchyClaimRepository = HierarchyParentRepository & { claimHierarchyFolderCreation(input: HierarchyClaimInput): Promise<HierarchyClaimResult> };
export type HierarchyClaimDependencies = { repository: HierarchyClaimRepository; departments: HierarchyDepartmentResolver; generateOperationToken?: () => string; resolveParent?: typeof resolveHierarchyParent; deriveMetadata?: typeof deriveHierarchyChildMetadata };
export type HierarchyDriveIdRepository = { persistHierarchyDriveFolderId(input: { folderId: string; actorId: string; operationToken: string; driveFolderId: string }): Promise<boolean> };
export type HierarchyDriveIdProvider = { generateId(): Promise<string> };
export type HierarchyDriveIdReservationInput = { actorId: string; claim: Extract<ClaimHierarchyCreationResult, { status: "OWNED" }> };
export type HierarchyDriveIdReservationResult = { status: "READY_FOR_CREATE"; folderId: string; operationToken: string; driveFolderId: string; metadata: DerivedHierarchyChildMetadata };
export type HierarchyDriveFolderMetadata = { id: string; name: string; parents: string[]; mimeType: string; trashed: boolean };
export type HierarchyDriveFolderProvider = { create(input: { id: string; parentId: string; name: string }): Promise<HierarchyDriveFolderMetadata>; get(folderId: string): Promise<HierarchyDriveFolderMetadata | null> };
export type VerifiedHierarchyDriveFolderResult = { status: "VERIFIED"; folderId: string; operationToken: string; driveFolderId: string; metadata: DerivedHierarchyChildMetadata };
export type FinalizeHierarchyCreationResult = { status: "ACTIVE"; folderId: string; driveFolderId: string; metadata: DerivedHierarchyChildMetadata };
export type TerminalHierarchyFailureResult = { status: "FAILED"; folderId: string; safeErrorCategory: "DRIVE_UNKNOWN" } | { status: "LEFT_CREATING"; folderId: string };
export type HierarchyLifecycleOperation = Pick<HierarchyDriveIdReservationResult, "folderId" | "operationToken" | "driveFolderId" | "metadata">;

export function canCreateChild(parentKind: "DEPARTMENT" | HierarchyKind | null, childKind: HierarchyKind) {
  return (parentKind === "DEPARTMENT" && childKind === "YEAR") || (parentKind === "YEAR" && childKind === "CATEGORY") || (parentKind === "CATEGORY" && (childKind === "SUBCATEGORY" || childKind === "WORKING_FOLDER")) || (parentKind === "SUBCATEGORY" && childKind === "WORKING_FOLDER");
}

const applicationUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function resolveHierarchyParent(input: ResolveHierarchyParentInput, dependencies: { repository: HierarchyParentRepository; departments: HierarchyDepartmentResolver }): Promise<ResolvedHierarchyParent> {
  if (input.parentRef.startsWith("department:")) {
    if (input.parentRef !== "department:ADMIN" || input.departmentKey !== "ADMIN" || !canCreateChild("DEPARTMENT", input.childKind)) throw new HierarchyServiceError("INVALID_HIERARCHY");
    try {
      const department = dependencies.departments.getDepartmentConfig("ADMIN");
      const root = dependencies.departments.resolveDepartmentDriveRoot("ADMIN");
      if (!department.enabled || !root.enabled || !root.driveRootId) throw new HierarchyServiceError("DEPARTMENT_UNAVAILABLE");
      return { type: "DEPARTMENT_ROOT", departmentKey: "ADMIN", parentFolderId: null, logicalParentKey: "department:ADMIN", driveParentId: root.driveRootId };
    } catch (error) {
      if (error instanceof HierarchyServiceError) throw error;
      throw new HierarchyServiceError("DEPARTMENT_UNAVAILABLE");
    }
  }
  if (input.departmentKey !== "ADMIN" || !applicationUuid.test(input.parentRef)) throw new HierarchyServiceError("INVALID_PARENT");
  let parent: HierarchyFolderRecord | null;
  try { parent = await dependencies.repository.getActiveHierarchyFolderById(input.parentRef); }
  catch { throw new HierarchyServiceError("PARENT_UNAVAILABLE"); }
  if (!parent) throw new HierarchyServiceError("PARENT_NOT_FOUND");
  if (parent.status !== "ACTIVE" || !parent.departmentKey || !parent.hierarchyKind || !parent.logicalKey || !parent.driveFolderId) throw new HierarchyServiceError("PARENT_NOT_READY");
  if (parent.departmentKey !== input.departmentKey || !canCreateChild(parent.hierarchyKind, input.childKind)) throw new HierarchyServiceError("INVALID_HIERARCHY");
  return { type: "REGISTERED_FOLDER", departmentKey: parent.departmentKey, parentFolderId: parent.id, logicalParentKey: parent.logicalKey, driveParentId: parent.driveFolderId, parent };
}

function hierarchyName(value: unknown): { name: string; normalizedName: string } { if (typeof value !== "string") throw new HierarchyServiceError("INVALID_FOLDER_NAME"); try { return normalizeFolderName(value); } catch { throw new HierarchyServiceError("INVALID_FOLDER_NAME"); } }
function registeredParent(parent: ResolvedHierarchyParent): Extract<ResolvedHierarchyParent, { type: "REGISTERED_FOLDER" }> { if (parent.type !== "REGISTERED_FOLDER") throw new HierarchyServiceError("INVALID_HIERARCHY"); return parent; }
function inheritedYear(parent: HierarchyFolderRecord): number { const filingYear = parent.filingYear; if (typeof filingYear !== "number" || !Number.isInteger(filingYear)) throw new HierarchyServiceError("PARENT_NOT_READY"); return filingYear; }

export function deriveHierarchyChildMetadata(input: DeriveHierarchyChildMetadataInput): DerivedHierarchyChildMetadata {
  if (input.kind === "YEAR") {
    if (input.parent.type !== "DEPARTMENT_ROOT" || typeof input.filingYear !== "number" || !Number.isInteger(input.filingYear) || input.filingYear < 2000 || input.filingYear > 2100) throw new HierarchyServiceError("INVALID_YEAR");
    const filingYear = input.filingYear;
    const { name, normalizedName } = hierarchyName(String(filingYear));
    return { departmentKey: "ADMIN", hierarchyKind: "YEAR", parentFolderId: null, logicalParentKey: input.parent.logicalParentKey, driveParentId: input.parent.driveParentId, filingYear, category: null, subcategory: null, logicalKey: `ADMIN|${filingYear}`, name, normalizedName, source: "DYNAMIC", uploadEnabled: false };
  }
  const parent = registeredParent(input.parent);
  const record = parent.parent;
  const filingYear = inheritedYear(record);
  if (input.kind === "CATEGORY") {
    if (record.hierarchyKind !== "YEAR" || typeof input.category !== "string" || !isAdminCategory(input.category)) throw new HierarchyServiceError("INVALID_CATEGORY");
    const { name, normalizedName } = hierarchyName(input.category);
    return { departmentKey: parent.departmentKey, hierarchyKind: "CATEGORY", parentFolderId: parent.parentFolderId, logicalParentKey: parent.logicalParentKey, driveParentId: parent.driveParentId, filingYear, category: input.category, subcategory: null, logicalKey: `${parent.logicalParentKey}|${input.category}`, name, normalizedName, source: "DYNAMIC", uploadEnabled: false };
  }
  if (input.kind === "SUBCATEGORY") {
    const parentCategory = record.category;
    if (record.hierarchyKind !== "CATEGORY" || typeof parentCategory !== "string" || !isAdminCategory(parentCategory) || typeof input.subcategory !== "string" || !adminSubcategories[parentCategory]?.includes(input.subcategory)) throw new HierarchyServiceError("INVALID_SUBCATEGORY");
    const { name, normalizedName } = hierarchyName(input.subcategory);
    return { departmentKey: parent.departmentKey, hierarchyKind: "SUBCATEGORY", parentFolderId: parent.parentFolderId, logicalParentKey: parent.logicalParentKey, driveParentId: parent.driveParentId, filingYear, category: parentCategory, subcategory: input.subcategory, logicalKey: `${parent.logicalParentKey}|${input.subcategory}`, name, normalizedName, source: "DYNAMIC", uploadEnabled: false };
  }
  if (record.hierarchyKind !== "CATEGORY" && record.hierarchyKind !== "SUBCATEGORY") throw new HierarchyServiceError("INVALID_HIERARCHY");
  const parentCategory = record.category;
  if (typeof parentCategory !== "string" || !isAdminCategory(parentCategory)) throw new HierarchyServiceError("PARENT_NOT_READY");
  if (record.hierarchyKind === "SUBCATEGORY" && !record.subcategory) throw new HierarchyServiceError("PARENT_NOT_READY");
  const { name, normalizedName } = hierarchyName(input.name);
  return { departmentKey: parent.departmentKey, hierarchyKind: "WORKING_FOLDER", parentFolderId: parent.parentFolderId, logicalParentKey: parent.logicalParentKey, driveParentId: parent.driveParentId, filingYear, category: parentCategory, subcategory: record.hierarchyKind === "SUBCATEGORY" ? record.subcategory : null, logicalKey: `${parent.logicalParentKey}|${normalizedName}`, name, normalizedName, source: "DYNAMIC", uploadEnabled: false };
}

export async function claimHierarchyCreation(input: ClaimHierarchyCreationInput, dependencies: HierarchyClaimDependencies): Promise<ClaimHierarchyCreationResult> {
  if (!applicationUuid.test(input.idempotencyKey)) throw new HierarchyServiceError("INVALID_IDEMPOTENCY");
  const resolveParent = dependencies.resolveParent ?? resolveHierarchyParent;
  const deriveMetadata = dependencies.deriveMetadata ?? deriveHierarchyChildMetadata;
  const parent = await resolveParent({ departmentKey: input.departmentKey, parentRef: input.parentRef, childKind: input.kind }, { repository: dependencies.repository, departments: dependencies.departments });
  const metadata = deriveMetadata({ parent, kind: input.kind, filingYear: input.requestedFilingYear, category: input.requestedCategory, subcategory: input.requestedSubcategory, name: input.requestedName });
  const operationToken = (dependencies.generateOperationToken ?? randomUUID)();
  let claim: HierarchyClaimResult;
  try { claim = await dependencies.repository.claimHierarchyFolderCreation({ actorId: input.actorId, idempotencyKey: input.idempotencyKey, parentFolderId: metadata.parentFolderId, logicalParentKey: metadata.logicalParentKey, driveParentId: metadata.driveParentId, departmentKey: metadata.departmentKey, hierarchyKind: metadata.hierarchyKind, filingYear: metadata.filingYear, category: metadata.category, subcategory: metadata.subcategory, logicalKey: metadata.logicalKey, name: metadata.name, normalizedName: metadata.normalizedName, operationToken }); }
  catch { throw new HierarchyServiceError("CLAIM_UNAVAILABLE"); }
  if (claim.kind === "DUPLICATE") throw new HierarchyServiceError("DUPLICATE_FOLDER");
  if (claim.kind === "OWNED") {
    if (!claim.folderId || !claim.operationToken) throw new HierarchyServiceError("CLAIM_UNAVAILABLE");
    return { status: "OWNED", folderId: claim.folderId, operationToken: claim.operationToken, driveFolderId: claim.driveFolderId, metadata };
  }
  return { status: claim.kind, folderId: claim.folderId, metadata };
}

export async function ensureHierarchyDriveFolderId(input: HierarchyDriveIdReservationInput, dependencies: { repository: HierarchyDriveIdRepository; provider: HierarchyDriveIdProvider }): Promise<HierarchyDriveIdReservationResult> {
  const { claim } = input;
  if (claim.driveFolderId) return { status: "READY_FOR_CREATE", folderId: claim.folderId, operationToken: claim.operationToken, driveFolderId: claim.driveFolderId, metadata: claim.metadata };
  let driveFolderId: string;
  try { driveFolderId = await dependencies.provider.generateId(); }
  catch { throw new HierarchyServiceError("DRIVE_ID_RESERVATION_UNAVAILABLE"); }
  if (typeof driveFolderId !== "string" || !driveFolderId.trim()) throw new HierarchyServiceError("DRIVE_ID_RESERVATION_UNAVAILABLE");
  let persisted: boolean;
  try { persisted = await dependencies.repository.persistHierarchyDriveFolderId({ folderId: claim.folderId, actorId: input.actorId, operationToken: claim.operationToken, driveFolderId }); }
  catch { throw new HierarchyServiceError("PERSIST_UNAVAILABLE"); }
  if (!persisted) throw new HierarchyServiceError("OPERATION_NOT_OWNED");
  return { status: "READY_FOR_CREATE", folderId: claim.folderId, operationToken: claim.operationToken, driveFolderId, metadata: claim.metadata };
}

function isExpectedHierarchyFolder(folder: HierarchyDriveFolderMetadata | null, expected: { id: string; name: string; parentId: string }) {
  return !!folder && folder.id === expected.id && folder.name === expected.name && folder.mimeType === "application/vnd.google-apps.folder" && folder.parents.includes(expected.parentId) && folder.trashed === false;
}

export async function createAndVerifyHierarchyDriveFolder(ready: HierarchyDriveIdReservationResult, provider: HierarchyDriveFolderProvider): Promise<VerifiedHierarchyDriveFolderResult> {
  if (!ready.driveFolderId.trim() || !ready.metadata.driveParentId.trim() || !ready.metadata.name.trim()) throw new HierarchyServiceError("PROVIDER_VERIFY_FAILED");
  const expected = { id: ready.driveFolderId, name: ready.metadata.name, parentId: ready.metadata.driveParentId };
  try { await provider.create({ id: expected.id, parentId: expected.parentId, name: expected.name }); }
  catch { throw new HierarchyServiceError("PROVIDER_CREATE_FAILED"); }
  let folder: HierarchyDriveFolderMetadata | null;
  try { folder = await provider.get(expected.id); }
  catch { throw new HierarchyServiceError("PROVIDER_VERIFY_FAILED"); }
  if (!folder) throw new HierarchyServiceError("PROVIDER_VERIFY_FAILED");
  if (!isExpectedHierarchyFolder(folder, expected)) throw new HierarchyServiceError("PROVIDER_OBJECT_MISMATCH");
  return { status: "VERIFIED", folderId: ready.folderId, operationToken: ready.operationToken, driveFolderId: ready.driveFolderId, metadata: ready.metadata };
}

export async function finalizeVerifiedHierarchyCreation(input: { actorId: string; verified: VerifiedHierarchyDriveFolderResult }, repository: { finalizeHierarchyFolder(input: { folderId: string; actorId: string; operationToken: string }): Promise<boolean> }): Promise<FinalizeHierarchyCreationResult> {
  let finalized: boolean;
  try { finalized = await repository.finalizeHierarchyFolder({ folderId: input.verified.folderId, actorId: input.actorId, operationToken: input.verified.operationToken }); }
  catch { throw new HierarchyServiceError("FINALIZE_UNAVAILABLE"); }
  if (!finalized) throw new HierarchyServiceError("OPERATION_NOT_OWNED");
  return { status: "ACTIVE", folderId: input.verified.folderId, driveFolderId: input.verified.driveFolderId, metadata: input.verified.metadata };
}

export async function markTerminalHierarchyCreationFailure(input: { actorId: string; operation: HierarchyLifecycleOperation; failureCode: "PROVIDER_CREATE_FAILED" | "PROVIDER_VERIFY_FAILED" | "PROVIDER_OBJECT_MISMATCH" }, repository: { markHierarchyFolderFailed(input: { folderId: string; actorId: string; operationToken: string; errorCategory: "DRIVE_UNKNOWN" }): Promise<boolean> }): Promise<TerminalHierarchyFailureResult> {
  if (input.failureCode !== "PROVIDER_OBJECT_MISMATCH") return { status: "LEFT_CREATING", folderId: input.operation.folderId };
  let marked: boolean;
  try { marked = await repository.markHierarchyFolderFailed({ folderId: input.operation.folderId, actorId: input.actorId, operationToken: input.operation.operationToken, errorCategory: "DRIVE_UNKNOWN" }); }
  catch { throw new HierarchyServiceError("MARK_FAILED_UNAVAILABLE"); }
  if (!marked) throw new HierarchyServiceError("OPERATION_NOT_OWNED");
  return { status: "FAILED", folderId: input.operation.folderId, safeErrorCategory: "DRIVE_UNKNOWN" };
}

export type HierarchyCreationOrchestratorDependencies = { claim: HierarchyClaimDependencies; repository: HierarchyDriveIdRepository & { finalizeHierarchyFolder(input: { folderId: string; actorId: string; operationToken: string }): Promise<boolean>; markHierarchyFolderFailed(input: { folderId: string; actorId: string; operationToken: string; errorCategory: "DRIVE_UNKNOWN" }): Promise<boolean> }; provider: HierarchyDriveIdProvider & HierarchyDriveFolderProvider };
export type HierarchyCreationInternalResult = FinalizeHierarchyCreationResult | TerminalHierarchyFailureResult | Extract<ClaimHierarchyCreationResult, { status: "ACTIVE_EXISTING" | "IN_PROGRESS" }>;

export async function createHierarchyFolderInternal(input: ClaimHierarchyCreationInput, dependencies: HierarchyCreationOrchestratorDependencies): Promise<HierarchyCreationInternalResult> {
  const claim = await claimHierarchyCreation(input, dependencies.claim);
  if (claim.status !== "OWNED") return claim;
  const ready = await ensureHierarchyDriveFolderId({ actorId: input.actorId, claim }, { repository: dependencies.repository, provider: dependencies.provider });
  let verified: VerifiedHierarchyDriveFolderResult;
  try { verified = await createAndVerifyHierarchyDriveFolder(ready, dependencies.provider); }
  catch (error) {
    if (error instanceof HierarchyServiceError && error.code === "PROVIDER_OBJECT_MISMATCH") return markTerminalHierarchyCreationFailure({ actorId: input.actorId, operation: ready, failureCode: error.code }, dependencies.repository);
    throw error;
  }
  return finalizeVerifiedHierarchyCreation({ actorId: input.actorId, verified }, dependencies.repository);
}

export function resolveApplicationFolderDestination(record: HierarchyRecord, requireUploadEnabled = false, departments?: Pick<HierarchyDepartmentResolver, "getDepartmentConfig">) {
  if (!departments || record.status !== "ACTIVE" || !record.department_key || !record.hierarchy_kind || !record.drive_folder_id || (requireUploadEnabled && !record.upload_enabled) || !departments.getDepartmentConfig(record.department_key).enabled) throw new Error("Hierarchy destination is unavailable.");
  return record;
}
export function reconcileStaticDynamic(staticId: string | null, dynamic: HierarchyRecord | null) {
  if (!staticId && !dynamic?.drive_folder_id) throw new Error("Hierarchy destination is unavailable.");
  if (staticId && dynamic?.drive_folder_id && staticId !== dynamic.drive_folder_id) throw new Error("Hierarchy destination configuration is inconsistent.");
  return dynamic?.drive_folder_id ?? staticId!;
}
