import { z } from "zod";
import { adminCategories, type AdminCategory } from "./admin-categories";
import type { DocumentStatus } from "./types";

export type FieldType = "text" | "number" | "date" | "select";

export interface StatusTransitionRule {
  from: DocumentStatus;
  to: DocumentStatus;
  allowedRoles: readonly ("ADMIN" | "STAFF")[];
}

export const STANDARD_STATUS_TRANSITIONS: readonly StatusTransitionRule[] = [
  { from: "DRAFT", to: "UNDER_REVIEW", allowedRoles: ["ADMIN", "STAFF"] },
  { from: "UNDER_REVIEW", to: "DRAFT", allowedRoles: ["ADMIN", "STAFF"] },
  { from: "UNDER_REVIEW", to: "APPROVED", allowedRoles: ["ADMIN"] },
  { from: "APPROVED", to: "ACTIVE", allowedRoles: ["ADMIN", "STAFF"] },
  { from: "ACTIVE", to: "SUPERSEDED", allowedRoles: ["ADMIN"] },
  { from: "ACTIVE", to: "ARCHIVED", allowedRoles: ["ADMIN"] },
  { from: "SUPERSEDED", to: "ARCHIVED", allowedRoles: ["ADMIN"] },
  { from: "ARCHIVED", to: "ACTIVE", allowedRoles: ["ADMIN"] },
  { from: "DRAFT", to: "ACTIVE", allowedRoles: ["ADMIN", "STAFF"] },
] as const;

export function isStatusTransitionAllowed(
  from: DocumentStatus,
  to: DocumentStatus,
  role: "ADMIN" | "STAFF" | "VIEWER",
): { allowed: boolean; reason?: string } {
  if (role !== "ADMIN" && role !== "STAFF") {
    return { allowed: false, reason: "Insufficient role to change document status." };
  }
  if (from === to) {
    return { allowed: true };
  }
  const match = STANDARD_STATUS_TRANSITIONS.find((rule) => rule.from === from && rule.to === to);
  if (!match) {
    return { allowed: false, reason: `Status transition from ${from} to ${to} is not permitted.` };
  }
  if (!match.allowedRoles.includes(role)) {
    return { allowed: false, reason: `Transition from ${from} to ${to} requires an administrator.` };
  }
  return { allowed: true };
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface CustomFieldDefinition {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: SelectOption[];
  description?: string;
  placeholder?: string;
  filterable?: boolean;
}

export interface DocumentTypeDefinition {
  type: AdminCategory;
  label: string;
  description: string;
  fields: CustomFieldDefinition[];
  schema: z.ZodObject<Record<string, z.ZodTypeAny>>;
}

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a valid YYYY-MM-DD date.")
  .optional()
  .or(z.literal(""));

export const DOCUMENT_TYPES_CONFIG: Record<AdminCategory, DocumentTypeDefinition> = {
  MEMORANDUM: {
    type: "MEMORANDUM",
    label: "Memorandum",
    description: "Official internal directives and memos across KWD divisions.",
    fields: [
      {
        key: "series_year",
        label: "Series year",
        type: "number",
        required: false,
        placeholder: "e.g. 2026",
        filterable: true,
      },
      {
        key: "office_origin",
        label: "Office of origin",
        type: "select",
        required: false,
        filterable: true,
        options: [
          { value: "OFFICE_OF_THE_GM", label: "Office of the General Manager" },
          { value: "ADMINISTRATIVE", label: "Administrative Division" },
          { value: "FINANCE", label: "Finance & Commercial Division" },
          { value: "OPERATIONS", label: "Operations & Technical Division" },
        ],
      },
      {
        key: "signatory",
        label: "Signatory",
        type: "text",
        required: false,
        placeholder: "Signatory name",
      },
      {
        key: "action_required",
        label: "Action required",
        type: "select",
        required: false,
        filterable: true,
        options: [
          { value: "FOR_INFORMATION", label: "For Information" },
          { value: "FOR_COMPLIANCE", label: "For Compliance" },
          { value: "FOR_IMPLEMENTATION", label: "For Implementation" },
          { value: "FOR_APPROVAL", label: "For Approval" },
        ],
      },
    ],
    schema: z.object({
      series_year: z.coerce.number().int().min(1900).max(2100).optional().nullable(),
      office_origin: z.string().max(100).optional().nullable(),
      signatory: z.string().max(200).optional().nullable(),
      action_required: z.string().max(50).optional().nullable(),
    }),
  },

  "BOARD RESOLUTION": {
    type: "BOARD RESOLUTION",
    label: "Board Resolution",
    description: "Official resolutions enacted by the KWD Board of Directors.",
    fields: [
      {
        key: "resolution_number",
        label: "Resolution number",
        type: "text",
        required: false,
        placeholder: "e.g. BR-2026-001",
        filterable: true,
      },
      {
        key: "session_date",
        label: "Board session date",
        type: "date",
        required: false,
        filterable: true,
      },
      {
        key: "presiding_officer",
        label: "Presiding officer",
        type: "text",
        required: false,
        placeholder: "Board Chairman",
      },
      {
        key: "sponsor",
        label: "Sponsor / Proponent",
        type: "text",
        required: false,
        placeholder: "Director name",
      },
    ],
    schema: z.object({
      resolution_number: z.string().max(100).optional().nullable(),
      session_date: isoDateSchema.nullable(),
      presiding_officer: z.string().max(200).optional().nullable(),
      sponsor: z.string().max(200).optional().nullable(),
    }),
  },

  CONTRACTS: {
    type: "CONTRACTS",
    label: "Contracts & MOAs",
    description: "Procurement, lease, and inter-agency agreements.",
    fields: [
      {
        key: "contractor_name",
        label: "Contractor / Other Party",
        type: "text",
        required: false,
        placeholder: "Company or individual name",
        filterable: true,
      },
      {
        key: "contract_amount",
        label: "Contract amount (PHP)",
        type: "number",
        required: false,
        placeholder: "0.00",
      },
      {
        key: "validity_start",
        label: "Effectivity date",
        type: "date",
        required: false,
      },
      {
        key: "validity_end",
        label: "Expiration date",
        type: "date",
        required: false,
        filterable: true,
      },
    ],
    schema: z.object({
      contractor_name: z.string().max(200).optional().nullable(),
      contract_amount: z.coerce.number().min(0).optional().nullable(),
      validity_start: isoDateSchema.nullable(),
      validity_end: isoDateSchema.nullable(),
    }),
  },

  "OFFICE ORDER": {
    type: "OFFICE ORDER",
    label: "Office Order",
    description: "Personnel assignments and administrative directives.",
    fields: [
      {
        key: "series_year",
        label: "Series year",
        type: "number",
        required: false,
        placeholder: "e.g. 2026",
      },
      {
        key: "addressed_to",
        label: "Addressed to",
        type: "text",
        required: false,
        placeholder: "Personnel or unit",
      },
    ],
    schema: z.object({
      series_year: z.coerce.number().int().min(1900).max(2100).optional().nullable(),
      addressed_to: z.string().max(200).optional().nullable(),
    }),
  },

  BAC: {
    type: "BAC",
    label: "Bids and Awards Committee",
    description: "Procurement agendas, minutes, and BAC resolutions.",
    fields: [
      {
        key: "procurement_project",
        label: "Project name",
        type: "text",
        required: false,
        placeholder: "Name of procurement project",
        filterable: true,
      },
      {
        key: "mode_of_procurement",
        label: "Mode of procurement",
        type: "select",
        required: false,
        filterable: true,
        options: [
          { value: "PUBLIC_BIDDING", label: "Competitive Bidding" },
          { value: "SHOPPING", label: "Shopping" },
          { value: "SMALL_VALUE", label: "Small Value Procurement" },
          { value: "DIRECT_CONTRACTING", label: "Direct Contracting" },
          { value: "NEGOTIATED", label: "Negotiated Procurement" },
        ],
      },
    ],
    schema: z.object({
      procurement_project: z.string().max(300).optional().nullable(),
      mode_of_procurement: z.string().max(50).optional().nullable(),
    }),
  },

  "BACTI TEST": createDefaultConfig("BACTI TEST", "Bacteriological Water Quality Test Results"),
  "BOARD MEETING MINUTES": createDefaultConfig("BOARD MEETING MINUTES", "Minutes of KWD Board meetings"),
  "OPERATIONS MANUAL": createDefaultConfig("OPERATIONS MANUAL", "Standard operating procedures and system manuals"),
  ATTENDANCE: createDefaultConfig("ATTENDANCE", "Daily time records, summaries, and schedules"),
  HRMO: createDefaultConfig("HRMO", "Human resource management records and appointments"),
  "GSIS / GSIS REQUEST": createDefaultConfig("GSIS / GSIS REQUEST", "GSIS records, requests, and clearances"),
  "REFERENCE & TEMPLATES": createDefaultConfig("REFERENCE & TEMPLATES", "Official forms and reference material"),
  "ANNUAL REPORT": createDefaultConfig("ANNUAL REPORT", "Annual administrative and operational reports"),
  LETTER: createDefaultConfig("LETTER", "Official incoming and outgoing correspondence"),
  "OTHER DOCUMENTS": createDefaultConfig("OTHER DOCUMENTS", "Miscellaneous official district documents"),
};

function createDefaultConfig(type: AdminCategory, description: string): DocumentTypeDefinition {
  return {
    type,
    label: type,
    description,
    fields: [],
    schema: z.object({}).passthrough(),
  };
}

export function getDocumentTypeConfig(type: string): DocumentTypeDefinition | undefined {
  return DOCUMENT_TYPES_CONFIG[type as AdminCategory];
}

export function getAllDocumentTypes(): DocumentTypeDefinition[] {
  return adminCategories.map((cat) => DOCUMENT_TYPES_CONFIG[cat]);
}

export function validateCustomMetadata(
  type: string,
  raw: unknown,
): { success: true; data: Record<string, unknown> } | { success: false; message: string; field?: string } {
  const config = getDocumentTypeConfig(type);
  if (!config) {
    return { success: true, data: {} };
  }

  if (raw === null || raw === undefined) {
    return { success: true, data: {} };
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { success: false, message: "Custom metadata must be a JSON object." };
  }

  const result = config.schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const fieldKey = typeof issue?.path[0] === "string" ? issue.path[0] : undefined;
    return {
      success: false,
      message: issue?.message ?? "Invalid custom metadata.",
      field: fieldKey,
    };
  }

  // Filter out null/undefined/empty string values for clean storage
  const cleaned: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(result.data)) {
    if (val !== null && val !== undefined && val !== "") {
      cleaned[key] = val;
    }
  }

  return { success: true, data: cleaned };
}
