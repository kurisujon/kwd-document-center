import type { DocumentListQuery, DocumentSortField, SortOrder } from "./types";

const defaultPageSize = 25;
const maximumPageSize = 100;
const supportedSortFields: readonly DocumentSortField[] = ["document_number", "document_type", "document_date", "subject", "created_at"];

export type QueryValidationResult =
  | { success: true; data: DocumentListQuery }
  | { success: false; field: string; message: string };

function singleValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? undefined : value;
}

function parsePositiveInteger(value: string | undefined, fallback: number, field: string): number | QueryValidationResult {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value)) return { success: false, field, message: `${field} must be a positive integer.` };
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return { success: false, field, message: `${field} must be a positive integer.` };
  return parsed;
}

function parseDate(value: string | undefined, field: string): string | QueryValidationResult | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return { success: false, field, message: `${field} must be a valid ISO date.` };
  }
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) {
    return { success: false, field, message: `${field} must be a valid ISO date.` };
  }
  return value;
}

export function parseDocumentListQuery(params: Record<string, string | string[] | undefined>): QueryValidationResult {
  const pageValue = parsePositiveInteger(singleValue(params.page), 1, "page");
  if (typeof pageValue !== "number") return pageValue;

  const pageSizeValue = parsePositiveInteger(singleValue(params.pageSize), defaultPageSize, "pageSize");
  if (typeof pageSizeValue !== "number") return pageSizeValue;
  if (pageSizeValue > maximumPageSize) return { success: false, field: "pageSize", message: `pageSize must not exceed ${maximumPageSize}.` };
  if (pageValue > Math.floor(Number.MAX_SAFE_INTEGER / pageSizeValue)) {
    return { success: false, field: "page", message: "page is too large." };
  }

  const sortBy = singleValue(params.sortBy) ?? "created_at";
  if (!supportedSortFields.includes(sortBy as DocumentSortField)) {
    return { success: false, field: "sortBy", message: "sortBy is not supported." };
  }

  const sortOrder = singleValue(params.sortOrder) ?? "desc";
  if (sortOrder !== "asc" && sortOrder !== "desc") {
    return { success: false, field: "sortOrder", message: "sortOrder must be asc or desc." };
  }

  const q = singleValue(params.q)?.trim();
  const type = singleValue(params.type)?.trim();
  const dateFrom = parseDate(singleValue(params.dateFrom), "dateFrom");
  if (typeof dateFrom === "object") return dateFrom;
  const dateTo = parseDate(singleValue(params.dateTo), "dateTo");
  if (typeof dateTo === "object") return dateTo;
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return { success: false, field: "dateTo", message: "dateTo must be on or after dateFrom." };
  }

  return {
    success: true,
    data: {
      ...(q ? { q } : {}),
      ...(type ? { type } : {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
      page: pageValue,
      pageSize: pageSizeValue,
      sortBy: sortBy as DocumentSortField,
      sortOrder: sortOrder as SortOrder,
    },
  };
}

export function isDocumentId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
