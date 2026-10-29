import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AuthorizationResult, AuthorizedUser } from "../auth/types";
import { isValidIsoDate } from "../documents/query";
import { protectedJson } from "../http/response";
import { logOperationalFailure } from "../observability/log";

export const AUDIT_ACTIONS = [
  "DOCUMENT_UPLOAD",
  "DOCUMENT_OPEN",
  "DOCUMENT_DOWNLOAD",
  "DOCUMENT_CONFIDENTIALITY_CHANGE",
  "DOCUMENT_DELETE",
  "DOCUMENT_RESTORE",
  "DOCUMENT_PURGE",
  "USER_CREATE",
  "USER_UPDATE",
  "FOLDER_CREATE",
  "DOCUMENT_STATUS_CHANGE",
  "DOCUMENT_LINK_CREATE",
  "DOCUMENT_LINK_DELETE",
  "DOCUMENT_VERSION_UPLOAD",
  "DOCUMENT_TAG_ADD",
  "DOCUMENT_TAG_REMOVE",
  "DOCUMENT_COMMENT_CREATE",
  "DOCUMENT_COMMENT_DELETE",
  "DOCUMENT_RETENTION_FLAG",
  "DOCUMENT_RETENTION_APPROVE",
  "REMINDER_SENT",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ENTITY_TYPES = ["DOCUMENT", "USER", "FOLDER"] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export type AuditLogEntry = {
  id: string;
  actor_id: string;
  actor_email: string;
  action: AuditAction;
  entity_type: AuditEntityType;
  entity_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AuditLogListQuery = {
  actor: string;
  action: AuditAction | "";
  entityType: AuditEntityType | "";
  entityId: string;
  dateFrom: string;
  dateTo: string;
  page: number;
  pageSize: number;
};

export type AuditLogListResult = {
  entries: AuditLogEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const knownDatabaseCodes = [
  "ADMIN_REQUIRED",
  "DOCUMENT_NOT_FOUND",
  "VALIDATION_ERROR",
  "AUDIT_LOG_IMMUTABLE",
] as const;

export type AuditRepositoryErrorCode = (typeof knownDatabaseCodes)[number] | "UNKNOWN";

export class AuditRepositoryError extends Error {
  readonly code: AuditRepositoryErrorCode;

  constructor(code: AuditRepositoryErrorCode) {
    super("Audit log operation failed.");
    this.code = code;
  }
}

export class AuditQueryValidationError extends Error {
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.field = field;
  }
}

const auditRowSchema = z.object({
  id: z.string().uuid(),
  actor_id: z.string().uuid(),
  actor_email: z.string().min(1),
  action: z.enum(AUDIT_ACTIONS),
  entity_type: z.enum(AUDIT_ENTITY_TYPES),
  entity_id: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string().min(1),
  total_count: z.union([z.number(), z.string()]).optional(),
});

export function validateAuditLogQuery(
  raw: Record<string, string | string[] | undefined>,
): AuditLogListQuery {
  const first = (key: string) => {
    const val = raw[key];
    return typeof val === "string" ? val.trim() : "";
  };

  const actor = first("actor");
  if (actor.length > 254) {
    throw new AuditQueryValidationError("Actor filter must be 254 characters or fewer.", "actor");
  }

  const rawAction = first("action");
  if (rawAction && !AUDIT_ACTIONS.includes(rawAction as AuditAction)) {
    throw new AuditQueryValidationError("Action filter is invalid.", "action");
  }

  const rawEntityType = first("entityType");
  if (rawEntityType && !AUDIT_ENTITY_TYPES.includes(rawEntityType as AuditEntityType)) {
    throw new AuditQueryValidationError("Entity type filter is invalid.", "entityType");
  }

  const entityId = first("entityId");
  if (entityId.length > 128) {
    throw new AuditQueryValidationError("Entity ID filter must be 128 characters or fewer.", "entityId");
  }

  const dateFrom = first("dateFrom");
  if (dateFrom && !isValidIsoDate(dateFrom)) {
    throw new AuditQueryValidationError("Start date must be a valid YYYY-MM-DD date.", "dateFrom");
  }

  const dateTo = first("dateTo");
  if (dateTo && !isValidIsoDate(dateTo)) {
    throw new AuditQueryValidationError("End date must be a valid YYYY-MM-DD date.", "dateTo");
  }

  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new AuditQueryValidationError("Start date cannot be after end date.", "dateFrom");
  }

  const rawPage = first("page");
  let page = 1;
  if (rawPage) {
    if (!/^[1-9]\d*$/.test(rawPage)) {
      throw new AuditQueryValidationError("Page must be a positive integer.", "page");
    }
    page = Number(rawPage);
  }

  const rawPageSize = first("pageSize");
  let pageSize = 25;
  if (rawPageSize) {
    if (!/^[1-9]\d*$/.test(rawPageSize)) {
      throw new AuditQueryValidationError("Page size must be between 1 and 100.", "pageSize");
    }
    pageSize = Number(rawPageSize);
    if (pageSize < 1 || pageSize > 100) {
      throw new AuditQueryValidationError("Page size must be between 1 and 100.", "pageSize");
    }
  }

  return {
    actor,
    action: (rawAction as AuditAction) || "",
    entityType: (rawEntityType as AuditEntityType) || "",
    entityId,
    dateFrom,
    dateTo,
    page,
    pageSize,
  };
}

export interface AuditRepository {
  listAuditLogs(actorId: string, query: AuditLogListQuery): Promise<AuditLogListResult>;
  recordDocumentAccessAudit(
    actorId: string,
    documentId: string,
    action: "DOCUMENT_OPEN" | "DOCUMENT_DOWNLOAD",
  ): Promise<void>;
}

export function createLazyAuditRepository(factory: () => AuditRepository): AuditRepository {
  return {
    listAuditLogs: (actorId, query) => factory().listAuditLogs(actorId, query),
    recordDocumentAccessAudit: (actorId, documentId, action) =>
      factory().recordDocumentAccessAudit(actorId, documentId, action),
  };
}

type RpcClient = Pick<SupabaseClient, "rpc">;

function mapDatabaseError(error: unknown): AuditRepositoryError {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : "";
  const code = knownDatabaseCodes.find((candidate) => message.includes(candidate));
  return new AuditRepositoryError(code ?? "UNKNOWN");
}

export function createAuditRepository(supabase: RpcClient): AuditRepository {
  return {
    async listAuditLogs(actorId, query) {
      const offset = (query.page - 1) * query.pageSize;
      const { data, error } = await supabase.rpc("admin_list_audit_logs", {
        p_actor_id: actorId,
        p_filter_actor: query.actor || null,
        p_filter_action: query.action || null,
        p_filter_entity_type: query.entityType || null,
        p_filter_entity_id: query.entityId || null,
        p_date_from: query.dateFrom ? `${query.dateFrom}T00:00:00.000Z` : null,
        p_date_to: query.dateTo ? `${query.dateTo}T23:59:59.999Z` : null,
        p_limit: query.pageSize,
        p_offset: offset,
      });

      if (error) throw mapDatabaseError(error);
      if (!Array.isArray(data)) throw new AuditRepositoryError("UNKNOWN");

      let total = 0;
      const entries: AuditLogEntry[] = data.map((row) => {
        const parsed = auditRowSchema.safeParse(row);
        if (!parsed.success) throw new AuditRepositoryError("UNKNOWN");
        if (parsed.data.total_count !== undefined) {
          total = Number(parsed.data.total_count) || 0;
        }
        return {
          id: parsed.data.id,
          actor_id: parsed.data.actor_id,
          actor_email: parsed.data.actor_email,
          action: parsed.data.action,
          entity_type: parsed.data.entity_type,
          entity_id: parsed.data.entity_id,
          metadata: parsed.data.metadata,
          created_at: parsed.data.created_at,
        };
      });

      return {
        entries,
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      };
    },

    async recordDocumentAccessAudit(actorId, documentId, action) {
      const { error } = await supabase.rpc("record_document_access_audit", {
        p_actor_id: actorId,
        p_document_id: documentId,
        p_action: action,
      });
      if (error) throw mapDatabaseError(error);
    },
  };
}

function jsonError(code: string, message: string, status: number, field?: string) {
  return protectedJson({ error: { code, message, ...(field ? { field } : {}) } }, status);
}

async function requireActiveAdmin(
  getAuthorization: () => Promise<AuthorizationResult>,
): Promise<{ response: Response } | { user: AuthorizedUser }> {
  const authorization = await getAuthorization();
  if (authorization.kind === "unauthenticated") {
    return { response: jsonError("UNAUTHORIZED", "Sign in is required.", 401) };
  }
  if (authorization.kind !== "authorized") {
    return { response: jsonError("FORBIDDEN", "You are not authorized to view audit logs.", 403) };
  }
  if (authorization.user.role !== "ADMIN" || authorization.user.status !== "ACTIVE") {
    return { response: jsonError("ADMIN_REQUIRED", "Administrator access is required.", 403) };
  }
  return { user: authorization.user };
}

export function createListAuditLogsHandler(dependencies: {
  getAuthorization: () => Promise<AuthorizationResult>;
  repository: AuditRepository;
}) {
  return async function GET(request: Request) {
    const auth = await requireActiveAdmin(dependencies.getAuthorization);
    if ("response" in auth) return auth.response;

    const url = new URL(request.url);
    const rawParams = Object.fromEntries(url.searchParams.entries());

    let query: AuditLogListQuery;
    try {
      query = validateAuditLogQuery(rawParams);
    } catch (error) {
      if (error instanceof AuditQueryValidationError) {
        return jsonError("VALIDATION_ERROR", error.message, 400, error.field);
      }
      return jsonError("VALIDATION_ERROR", "The audit log query parameters are invalid.", 400);
    }

    try {
      const result = await dependencies.repository.listAuditLogs(auth.user.id, query);
      return protectedJson(result, 200);
    } catch (error) {
      if (error instanceof AuditRepositoryError && error.code === "ADMIN_REQUIRED") {
        return jsonError("ADMIN_REQUIRED", "Administrator access is required.", 403);
      }
      logOperationalFailure({
        operation: "admin.audit_log.list",
        outcome: "failure",
        category: "AUDIT_LOG_READ_FAILED",
        status: 500,
      });
      return jsonError("REGISTRY_ERROR", "Audit logs are temporarily unavailable.", 500);
    }
  };
}
