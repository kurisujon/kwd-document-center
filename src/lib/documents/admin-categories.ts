export const adminCategories = [
  "BACTI TEST",
  "BAC",
  "BOARD MEETING MINUTES",
  "MEMORANDUM",
  "OPERATIONS MANUAL",
  "ATTENDANCE",
  "CONTRACTS",
  "HRMO",
  "GSIS / GSIS REQUEST",
  "REFERENCE & TEMPLATES",
  "ANNUAL REPORT",
  "OFFICE ORDER",
  "LETTER",
  "BOARD RESOLUTION",
  "OTHER DOCUMENTS",
] as const;

export type AdminCategory = (typeof adminCategories)[number];

export const adminSubcategories: Partial<Record<AdminCategory, readonly string[]>> = {
  BAC: ["AGENDAS", "MEETING MINUTES", "RESOLUTIONS"],
  ATTENDANCE: [
    "REGULAR & CASUAL",
    "CONTRACT OF SERVICE & JOB ORDER",
    "DTR SUMMARY",
    "SCHEDULE",
  ],
};

export function categoryUsesYear(category: AdminCategory): boolean {
  return category !== "REFERENCE & TEMPLATES";
}

export function isAdminCategory(value: string): value is AdminCategory {
  return adminCategories.includes(value as AdminCategory);
}

export function getAdminFolderMappingKey(category: AdminCategory, year?: number, subcategory?: string): string {
  return ["ADMIN", year, category, subcategory].filter((part) => part !== undefined && part !== "").join("|");
}
