import crypto from "node:crypto";
import { getAuthorization } from "@/lib/auth/server";
import type { AdminCategory } from "@/lib/documents/admin-categories";
import { getAdminDriveFolderId } from "@/lib/documents/drive-config";
import { createLifecycleRepository, listDocumentVersions } from "@/lib/documents/lifecycle-repository";
import { isDocumentId } from "@/lib/documents/query";
import { getDocumentById } from "@/lib/documents/repository";
import {
  UploadValidationError,
  validateAdminUploadFile,
} from "@/lib/documents/upload-validation";
import { createDriveService } from "@/lib/google/drive";
import { isSameOrigin } from "@/lib/http/origin";
import { protectedJson } from "@/lib/http/response";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isDocumentId(id)) {
    return protectedJson({ error: { code: "VALIDATION_ERROR", message: "Invalid document ID." } }, 400);
  }

  const authorization = await getAuthorization();
  if (authorization.kind === "unauthenticated") {
    return protectedJson({ error: { code: "UNAUTHORIZED", message: "Sign in required." } }, 401);
  }
  if (authorization.kind !== "authorized" || authorization.user.status !== "ACTIVE") {
    return protectedJson({ error: { code: "FORBIDDEN", message: "Active user required." } }, 403);
  }

  const versions = await listDocumentVersions(await createClient(), id, authorization.user);
  return protectedJson({ versions });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isDocumentId(id)) {
    return protectedJson({ error: { code: "VALIDATION_ERROR", message: "Invalid document ID." } }, 400);
  }

  const authorization = await getAuthorization();
  if (authorization.kind === "unauthenticated") {
    return protectedJson({ error: { code: "UNAUTHORIZED", message: "Sign in required." } }, 401);
  }
  if (authorization.kind !== "authorized" || authorization.user.status !== "ACTIVE" || authorization.user.role === "VIEWER") {
    return protectedJson({ error: { code: "FORBIDDEN", message: "Staff or Administrator access required." } }, 403);
  }
  if (!isSameOrigin(request)) {
    return protectedJson({ error: { code: "FORBIDDEN", message: "Cross-origin requests forbidden." } }, 403);
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return protectedJson({ error: { code: "VALIDATION_ERROR", message: "Form data required." } }, 400);
  }

  const file = formData.get("file");
  const changeSummary = String(formData.get("change_summary") ?? "");
  if (!file || typeof file === "string") {
    return protectedJson({ error: { code: "VALIDATION_ERROR", message: "File is required." } }, 400);
  }

  let validatedFile: Awaited<ReturnType<typeof validateAdminUploadFile>>;
  try {
    validatedFile = await validateAdminUploadFile(file as File);
  } catch (err) {
    if (err instanceof UploadValidationError) {
      return protectedJson({ error: { code: "VALIDATION_ERROR", message: err.message, field: err.field } }, 400);
    }
    return protectedJson({ error: { code: "VALIDATION_ERROR", message: "Invalid file." } }, 400);
  }

  const supabase = await createClient();
  const document = await getDocumentById(supabase, id, authorization.user);
  if (!document) {
    return protectedJson({ error: { code: "NOT_FOUND", message: "Document not found." } }, 404);
  }

  const fileSha256 = crypto.createHash("sha256").update(validatedFile.bytes).digest("hex");
  const drive = createDriveService();

  try {
    const driveFileId = await drive.generateFileId();
    const folderId = getAdminDriveFolderId(
      document.document_type as AdminCategory,
      document.filing_year,
      document.filing_subcategory ?? "",
    );
    const uploadedDriveFile = await drive.upload({
      fileId: driveFileId,
      folderId,
      name: validatedFile.name,
      mimeType: validatedFile.mimeType,
      bytes: validatedFile.bytes,
      uploadAttemptId: driveFileId,
    });

    const repository = createLifecycleRepository(createAdminClient());
    const version = await repository.addVersion({
      actorId: authorization.user.id,
      documentId: id,
      driveFileId: uploadedDriveFile.id,
      fileName: validatedFile.name,
      fileType: validatedFile.mimeType,
      fileSize: validatedFile.size,
      fileSha256,
      changeSummary,
    });

    return protectedJson({ version }, 201);
  } catch (err) {
    return protectedJson({ error: { code: "VERSION_UPLOAD_FAILED", message: (err as Error).message || "Failed to upload new version." } }, 500);
  }
}
