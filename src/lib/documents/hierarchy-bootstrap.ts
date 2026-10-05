import { adminSubcategories, isAdminCategory, type AdminCategory } from "./admin-categories";
import { normalizeFolderName } from "./folder-validation";

const hierarchyCategories = new Set<AdminCategory>(["BACTI TEST", "BAC", "ATTENDANCE", "BOARD MEETING MINUTES", "MEMORANDUM", "OPERATIONS MANUAL", "BOARD RESOLUTION", "CONTRACTS", "REFERENCE & TEMPLATES"]);
const validYear = (value: number) => Number.isInteger(value) && value >= 2000 && value <= 2100;

export type TrustedStaticHierarchyConfig = { adminRootDriveId: string | null; destinations: ReadonlyArray<{ logicalKey: string; driveFolderId: string }> };
export type StaticHierarchyBootstrapNode = { departmentKey: "ADMIN"; hierarchyKind: "YEAR" | "CATEGORY" | "SUBCATEGORY"; parentLogicalKey: string | null; logicalParentKey: string; driveParentId: string; driveFolderId: string; filingYear: number; category: AdminCategory | null; subcategory: string | null; logicalKey: string; name: string; normalizedName: string; uploadEnabled: false };
export type StaticHierarchyBootstrapSkipReason = "UNSUPPORTED_DEPARTMENT" | "LEGACY_ONLY" | "INVALID_HIERARCHY" | "MISSING_NODE_DRIVE_ID" | "MISSING_PARENT_NODE" | "UNAPPROVED_TAXONOMY" | "MALFORMED_CONFIG";
export type StaticHierarchyBootstrapSkip = { logicalKey: string; reason: StaticHierarchyBootstrapSkipReason };
export type StaticHierarchyBootstrapPlan = { registrations: StaticHierarchyBootstrapNode[]; skipped: StaticHierarchyBootstrapSkip[] };
export class StaticHierarchyBootstrapConfigurationError extends Error { constructor() { super("Static hierarchy bootstrap configuration is inconsistent."); } }
export class StaticHierarchyBootstrapExecutionError extends Error { constructor() { super("Static hierarchy bootstrap execution could not continue."); } }
export type StaticHierarchyBootstrapRegistrationResult = { folderId: string; created: boolean };
export type StaticHierarchyBootstrapRepository = { registerStaticHierarchyFolder(input: { actorId: string; parentFolderId: string | null; logicalParentKey: string; driveParentId: string; departmentKey: string; hierarchyKind: "YEAR" | "CATEGORY" | "SUBCATEGORY"; filingYear: number; category: AdminCategory | null; subcategory: string | null; name: string; normalizedName: string; logicalKey: string; driveFolderId: string; uploadEnabled: boolean }): Promise<StaticHierarchyBootstrapRegistrationResult> };
export type StaticHierarchyBootstrapExecutionResult = { registered: Array<{ logicalKey: string; folderId: string }> };

type Parsed = { logicalKey: string; year: number; category: AdminCategory | null; subcategory: string | null; hierarchyKind: "YEAR" | "CATEGORY" | "SUBCATEGORY" };
function parse(logicalKey: string): Parsed | { reason: StaticHierarchyBootstrapSkipReason } {
  const parts = logicalKey.split("|");
  if (parts[0] !== "ADMIN") return { reason: parts[0] ? "UNSUPPORTED_DEPARTMENT" : "MALFORMED_CONFIG" };
  if (parts.length < 2 || !/^\d{4}$/.test(parts[1] ?? "")) return { reason: "LEGACY_ONLY" };
  const year = Number(parts[1]);
  if (!validYear(year)) return { reason: "INVALID_HIERARCHY" };
  if (parts.length === 2) return { logicalKey, year, category: null, subcategory: null, hierarchyKind: "YEAR" };
  const category = parts[2] ?? "";
  if (!isAdminCategory(category) || !hierarchyCategories.has(category)) return { reason: "UNAPPROVED_TAXONOMY" };
  if (parts.length === 3) return { logicalKey, year, category, subcategory: null, hierarchyKind: "CATEGORY" };
  if (parts.length === 4 && adminSubcategories[category]?.includes(parts[3] ?? "")) return { logicalKey, year, category, subcategory: parts[3]!, hierarchyKind: "SUBCATEGORY" };
  return { reason: parts.length === 4 ? "UNAPPROVED_TAXONOMY" : "INVALID_HIERARCHY" };
}
function addSkip(skipped: StaticHierarchyBootstrapSkip[], logicalKey: string, reason: StaticHierarchyBootstrapSkipReason) { if (!skipped.some((skip) => skip.logicalKey === logicalKey && skip.reason === reason)) skipped.push({ logicalKey, reason }); }
function node(input: Omit<StaticHierarchyBootstrapNode, "name" | "normalizedName"> & { rawName: string }): StaticHierarchyBootstrapNode { const { rawName, ...value } = input; const { name, normalizedName } = normalizeFolderName(rawName); return { ...value, name, normalizedName }; }

export function buildStaticHierarchyBootstrapPlan(config: TrustedStaticHierarchyConfig): StaticHierarchyBootstrapPlan {
  const ids = new Map<string, string>(); const identities = new Map<string, string>();
  for (const entry of config.destinations) {
    const existing = ids.get(entry.logicalKey); if (existing && existing !== entry.driveFolderId) throw new StaticHierarchyBootstrapConfigurationError();
    const owner = identities.get(entry.driveFolderId); if (owner && owner !== entry.logicalKey) throw new StaticHierarchyBootstrapConfigurationError();
    ids.set(entry.logicalKey, entry.driveFolderId); identities.set(entry.driveFolderId, entry.logicalKey);
  }
  const skipped: StaticHierarchyBootstrapSkip[] = []; const parsed = new Map<string, Parsed>();
  for (const key of ids.keys()) { const result = parse(key); if ("reason" in result) addSkip(skipped, key, result.reason); else parsed.set(key, result); }
  const years = new Set<number>(); const categories = new Map<string, { year: number; category: AdminCategory }>(); const subcategories = new Map<string, { year: number; category: AdminCategory; subcategory: string }>();
  for (const item of parsed.values()) { years.add(item.year); if (item.category) categories.set(`ADMIN|${item.year}|${item.category}`, { year: item.year, category: item.category }); if (item.category && item.subcategory) subcategories.set(item.logicalKey, { year: item.year, category: item.category, subcategory: item.subcategory }); }
  const registrations: StaticHierarchyBootstrapNode[] = []; const registered = new Set<string>();
  for (const year of [...years].sort((a, b) => a - b)) { const logicalKey = `ADMIN|${year}`; const driveFolderId = ids.get(logicalKey); if (!config.adminRootDriveId) addSkip(skipped, logicalKey, "MISSING_PARENT_NODE"); else if (!driveFolderId) addSkip(skipped, logicalKey, "MISSING_NODE_DRIVE_ID"); else { registrations.push(node({ departmentKey: "ADMIN", hierarchyKind: "YEAR", parentLogicalKey: null, logicalParentKey: "department:ADMIN", driveParentId: config.adminRootDriveId, driveFolderId, filingYear: year, category: null, subcategory: null, logicalKey, uploadEnabled: false, rawName: String(year) })); registered.add(logicalKey); } }
  for (const [logicalKey, item] of [...categories.entries()].sort(([left], [right]) => left.localeCompare(right))) { const driveFolderId = ids.get(logicalKey); const parentLogicalKey = `ADMIN|${item.year}`; if (!registered.has(parentLogicalKey)) addSkip(skipped, logicalKey, "MISSING_PARENT_NODE"); else if (!driveFolderId) addSkip(skipped, logicalKey, "MISSING_NODE_DRIVE_ID"); else { registrations.push(node({ departmentKey: "ADMIN", hierarchyKind: "CATEGORY", parentLogicalKey, logicalParentKey: parentLogicalKey, driveParentId: ids.get(parentLogicalKey)!, driveFolderId, filingYear: item.year, category: item.category, subcategory: null, logicalKey, uploadEnabled: false, rawName: item.category })); registered.add(logicalKey); } }
  for (const [logicalKey, item] of [...subcategories.entries()].sort(([left], [right]) => left.localeCompare(right))) { const driveFolderId = ids.get(logicalKey); const parentLogicalKey = `ADMIN|${item.year}|${item.category}`; if (!registered.has(parentLogicalKey)) addSkip(skipped, logicalKey, "MISSING_PARENT_NODE"); else if (!driveFolderId) addSkip(skipped, logicalKey, "MISSING_NODE_DRIVE_ID"); else { registrations.push(node({ departmentKey: "ADMIN", hierarchyKind: "SUBCATEGORY", parentLogicalKey, logicalParentKey: parentLogicalKey, driveParentId: ids.get(parentLogicalKey)!, driveFolderId, filingYear: item.year, category: item.category, subcategory: item.subcategory, logicalKey, uploadEnabled: false, rawName: item.subcategory })); registered.add(logicalKey); } }
  return { registrations, skipped: skipped.sort((left, right) => left.logicalKey.localeCompare(right.logicalKey) || left.reason.localeCompare(right.reason)) };
}

export async function executeStaticHierarchyBootstrapPlan(input: { actorId: string; plan: StaticHierarchyBootstrapPlan; repository: StaticHierarchyBootstrapRepository }): Promise<StaticHierarchyBootstrapExecutionResult> {
  const applicationIds = new Map<string, string>(); const registered: Array<{ logicalKey: string; folderId: string }> = [];
  for (const node of input.plan.registrations) {
    const parentFolderId = node.hierarchyKind === "YEAR" ? null : node.parentLogicalKey ? applicationIds.get(node.parentLogicalKey) : undefined;
    if (node.hierarchyKind !== "YEAR" && !parentFolderId) throw new StaticHierarchyBootstrapExecutionError();
    let result: StaticHierarchyBootstrapRegistrationResult;
    try { result = await input.repository.registerStaticHierarchyFolder({ actorId: input.actorId, parentFolderId: parentFolderId ?? null, logicalParentKey: node.logicalParentKey, driveParentId: node.driveParentId, departmentKey: node.departmentKey, hierarchyKind: node.hierarchyKind, filingYear: node.filingYear, category: node.category, subcategory: node.subcategory, name: node.name, normalizedName: node.normalizedName, logicalKey: node.logicalKey, driveFolderId: node.driveFolderId, uploadEnabled: false }); }
    catch { throw new StaticHierarchyBootstrapExecutionError(); }
    if (!result.folderId) throw new StaticHierarchyBootstrapExecutionError();
    applicationIds.set(node.logicalKey, result.folderId); registered.push({ logicalKey: node.logicalKey, folderId: result.folderId });
  }
  return { registered };
}
