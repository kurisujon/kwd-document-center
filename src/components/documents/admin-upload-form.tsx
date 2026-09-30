"use client";

import type { AdminCategory } from "@/lib/documents/admin-categories";
import { BatchUploadReview } from "./batch-upload-review";

export function AdminUploadForm({ categories, maxBytes }: { categories: readonly AdminCategory[]; maxBytes: number }) {
  return <BatchUploadReview categories={categories} maxBytes={maxBytes} />;
}
