import type { Role } from "../auth/types";
import type { DocumentLinkRecord } from "./types";

export interface SupersedeEdge {
  from_id: string;
  to_id: string;
  relation: string;
}

/**
 * Checks whether adding a SUPERSEDES link from `candidateFrom` to `candidateTo`
 * introduces a cycle. A cycle is formed if `candidateTo` already supersedes
 * `candidateFrom` directly or through a chain of supersede relationships.
 */
export function detectSupersedeCycle(
  existingLinks: readonly SupersedeEdge[],
  candidateFrom: string,
  candidateTo: string,
): boolean {
  if (candidateFrom === candidateTo) {
    return true;
  }

  const supersedeEdges = new Map<string, string[]>();
  for (const edge of existingLinks) {
    if (edge.relation === "SUPERSEDES") {
      const targets = supersedeEdges.get(edge.from_id) ?? [];
      targets.push(edge.to_id);
      supersedeEdges.set(edge.from_id, targets);
    }
  }

  // Traverse downstream from candidateTo to see if we can reach candidateFrom
  const queue = [candidateTo];
  const visited = new Set<string>([candidateTo]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const targets = supersedeEdges.get(current) ?? [];
    for (const target of targets) {
      if (target === candidateFrom) {
        return true;
      }
      if (!visited.has(target)) {
        visited.add(target);
        queue.push(target);
      }
    }
  }

  return false;
}

/**
 * Ensures non-admin viewers NEVER see links that reference confidential documents.
 */
export function filterLinksForViewer(
  links: readonly DocumentLinkRecord[],
  viewer?: { role: Role; status?: string },
): DocumentLinkRecord[] {
  if (!viewer || viewer.role === "ADMIN") {
    return [...links];
  }

  return links.filter((link) => {
    // If the target document metadata is confidential, hide the link from non-admin users
    if (link.target_document?.confidential) {
      return false;
    }
    return true;
  });
}
