import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "../auth/types";
import { filterLinksForViewer } from "./relationships";
import type {
  DocumentLinkRecord,
  DocumentRelation,
  DocumentStatus,
  DocumentVersionRecord,
  TagRecord,
} from "./types";

export interface LifecycleRepository {
  changeStatus(input: {
    actorId: string;
    documentId: string;
    newStatus: DocumentStatus;
    reason?: string;
  }): Promise<{ documentId: string; status: DocumentStatus; previousStatus: string }>;

  addLink(input: {
    actorId: string;
    fromId: string;
    toId: string;
    relation: DocumentRelation;
  }): Promise<DocumentLinkRecord>;

  removeLink(input: {
    actorId: string;
    linkId: string;
  }): Promise<boolean>;

  addVersion(input: {
    actorId: string;
    documentId: string;
    driveFileId: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    fileSha256: string;
    changeSummary?: string;
  }): Promise<DocumentVersionRecord>;

  addTag(input: {
    actorId: string;
    documentId: string;
    tagName: string;
    tagColor?: string;
  }): Promise<TagRecord>;

  removeTag(input: {
    actorId: string;
    documentId: string;
    tagId: string;
  }): Promise<boolean>;
}

export function createLifecycleRepository(client: SupabaseClient): LifecycleRepository {
  return {
    async changeStatus({ actorId, documentId, newStatus, reason }) {
      const { data, error } = await client.rpc("change_document_status", {
        p_actor_id: actorId,
        p_document_id: documentId,
        p_new_status: newStatus,
        p_reason: reason ?? "",
      });
      if (error) throw new Error(error.message || "STATUS_CHANGE_RPC_FAILED");
      const row = Array.isArray(data) ? data[0] : data;
      return {
        documentId: row.document_id,
        status: row.status as DocumentStatus,
        previousStatus: row.previous_status,
      };
    },

    async addLink({ actorId, fromId, toId, relation }) {
      const { data, error } = await client.rpc("add_document_link", {
        p_actor_id: actorId,
        p_from_id: fromId,
        p_to_id: toId,
        p_relation: relation,
      });
      if (error) throw new Error(error.message || "ADD_LINK_RPC_FAILED");
      const row = Array.isArray(data) ? data[0] : data;
      return {
        id: row.id,
        from_id: row.from_id,
        to_id: row.to_id,
        relation: row.relation as DocumentRelation,
        created_by: actorId,
        created_at: row.created_at,
      };
    },

    async removeLink({ actorId, linkId }) {
      const { data, error } = await client.rpc("remove_document_link", {
        p_actor_id: actorId,
        p_link_id: linkId,
      });
      if (error) throw new Error(error.message || "REMOVE_LINK_RPC_FAILED");
      return Boolean(data);
    },

    async addVersion({ actorId, documentId, driveFileId, fileName, fileType, fileSize, fileSha256, changeSummary }) {
      const { data, error } = await client.rpc("add_document_version", {
        p_actor_id: actorId,
        p_document_id: documentId,
        p_drive_file_id: driveFileId,
        p_file_name: fileName,
        p_file_type: fileType,
        p_file_size: fileSize,
        p_file_sha256: fileSha256,
        p_change_summary: changeSummary ?? "",
      });
      if (error) throw new Error(error.message || "ADD_VERSION_RPC_FAILED");
      const row = Array.isArray(data) ? data[0] : data;
      return {
        id: row.version_id,
        document_id: row.document_id,
        version_number: row.version_number,
        drive_file_id: row.drive_file_id,
        file_name: row.file_name,
        file_type: row.file_type,
        file_size: Number(row.file_size),
        file_sha256: row.file_sha256,
        change_summary: row.change_summary,
        created_by: actorId,
        created_at: row.created_at,
      };
    },

    async addTag({ actorId, documentId, tagName, tagColor }) {
      const { data, error } = await client.rpc("add_document_tag", {
        p_actor_id: actorId,
        p_document_id: documentId,
        p_tag_name: tagName,
        p_tag_color: tagColor ?? "blue",
      });
      if (error) throw new Error(error.message || "ADD_TAG_RPC_FAILED");
      const row = Array.isArray(data) ? data[0] : data;
      return {
        id: row.tag_id,
        name: row.tag_name,
        color: row.tag_color,
        created_at: new Date().toISOString(),
      };
    },

    async removeTag({ actorId, documentId, tagId }) {
      const { data, error } = await client.rpc("remove_document_tag", {
        p_actor_id: actorId,
        p_document_id: documentId,
        p_tag_id: tagId,
      });
      if (error) throw new Error(error.message || "REMOVE_TAG_RPC_FAILED");
      return Boolean(data);
    },
  };
}

export async function listDocumentLinks(
  supabase: SupabaseClient,
  documentId: string,
  viewer?: { role: Role; status?: "ACTIVE" | "INACTIVE" },
): Promise<DocumentLinkRecord[]> {
  if (viewer?.status && viewer.status !== "ACTIVE") return [];

  const { data, error } = await supabase
    .from("document_links")
    .select(`
      id,
      from_id,
      to_id,
      relation,
      created_by,
      created_at,
      target_document:documents!document_links_to_id_fkey(
        document_id,
        document_type,
        document_number,
        subject,
        confidential
      )
    `)
    .eq("from_id", documentId);

  if (error) return [];
  const rawLinks = (data ?? []) as unknown as DocumentLinkRecord[];
  return filterLinksForViewer(rawLinks, viewer);
}

export async function listDocumentVersions(
  supabase: SupabaseClient,
  documentId: string,
  viewer?: { role: Role; status?: "ACTIVE" | "INACTIVE" },
): Promise<DocumentVersionRecord[]> {
  if (viewer?.status && viewer.status !== "ACTIVE") return [];

  const { data, error } = await supabase
    .from("document_versions")
    .select("*")
    .eq("document_id", documentId)
    .order("version_number", { ascending: false });

  if (error) return [];
  return (data ?? []) as DocumentVersionRecord[];
}

export async function listDocumentTags(
  supabase: SupabaseClient,
  documentId: string,
  viewer?: { role: Role; status?: "ACTIVE" | "INACTIVE" },
): Promise<TagRecord[]> {
  if (viewer?.status && viewer.status !== "ACTIVE") return [];

  const { data, error } = await supabase
    .from("document_tags")
    .select(`
      tag:tags(id, name, color, created_at)
    `)
    .eq("document_id", documentId);

  if (error) return [];
  return ((data ?? []) as unknown as Array<{ tag: TagRecord }>).map((row) => row.tag).filter(Boolean);
}
