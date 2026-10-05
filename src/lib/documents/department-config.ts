import "server-only";

export type DepartmentKey = "ADMIN" | "ACCOUNTING";
type Department = { key: DepartmentKey; label: string; enabled: boolean; driveRootId: string | null };
const id = /^[A-Za-z0-9_-]{10,}$/;

function config(): Record<DepartmentKey, Department> {
  const adminId = process.env.GOOGLE_DRIVE_ADMIN_DEPARTMENT_ROOT_ID ?? null;
  return {
    ADMIN: { key: "ADMIN", label: "ADMIN DOCUMENTS", enabled: Boolean(adminId && id.test(adminId)), driveRootId: adminId && id.test(adminId) ? adminId : null },
    ACCOUNTING: { key: "ACCOUNTING", label: "ACCOUNTING DOCUMENTS", enabled: false, driveRootId: null },
  };
}
export function getDepartmentConfig(key: DepartmentKey) { return config()[key]; }
export function listEnabledHierarchyDepartments() { return Object.values(config()).filter((department) => department.enabled).map(({ key, label }) => ({ id: `department:${key}`, key, label })); }
export function resolveDepartmentDriveRoot(key: DepartmentKey) { const department = getDepartmentConfig(key); if (!department.enabled || !department.driveRootId) throw new Error("Department is not enabled."); return department; }
