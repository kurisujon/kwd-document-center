import { adminUploadFormats, type AdminUploadExtension } from "./upload-formats";
import { defaultAdminUploadMaxBytes } from "./upload-limits";

export const folderUploadLimits = {
  maxFileBytes: defaultAdminUploadMaxBytes,
  maxFiles: 25,
  maxTotalBytes: 64 * 1024 * 1024,
  maxDirectoryDepth: 8,
  maxUniqueDirectories: 100,
  maxRelativePathBytes: 1024,
  maxSegmentBytes: 240,
} as const;

export type FolderSelectionIssueCode =
  | "NO_FILES_SELECTED"
  | "MIXED_ROOTS"
  | "INVALID_PATH"
  | "PATH_TRAVERSAL"
  | "ABSOLUTE_PATH"
  | "PATH_TOO_DEEP"
  | "PATH_TOO_LONG"
  | "SEGMENT_TOO_LONG"
  | "CONTROL_CHARACTER"
  | "DUPLICATE_PATH"
  | "UNSUPPORTED_TYPE"
  | "INCONSISTENT_FILE_TYPE"
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "TOO_MANY_FILES"
  | "TOTAL_SIZE_EXCEEDED"
  | "TOO_MANY_DIRECTORIES";

export type FolderSelectionIssue = { code: FolderSelectionIssueCode };
export type FolderSelectionEntry = { name: string; size: number; type?: string; webkitRelativePath: string };
export type FolderSelectionFile = {
  index: number;
  name: string;
  size: number;
  type: string | undefined;
  originalRelativePath: string;
  relativePath?: string;
  collisionKey?: string;
  issues: FolderSelectionIssue[];
};
export type FolderSelectionManifest = {
  rootName: string | null;
  files: FolderSelectionFile[];
  totalFiles: number;
  totalBytes: number;
  uniqueDirectoryCount: number;
  issues: FolderSelectionIssue[];
  isValid: boolean;
};

type CanonicalPath = { rootName: string; relativePath: string; collisionKey: string; directories: string[] };
type CanonicalPathResult = { value: CanonicalPath } | { issue: FolderSelectionIssue };
export type CanonicalSourceRelativePath = { relativePath: string; collisionKey: string; directories: string[] };

const textEncoder = new TextEncoder();

function issue(code: FolderSelectionIssueCode): FolderSelectionIssue { return { code }; }
function byteLength(value: string) { return textEncoder.encode(value).byteLength; }
function hasControlCharacter(value: string) { return /[\u0000-\u001f\u007f]/.test(value); }
function extensionFor(name: string): AdminUploadExtension | undefined {
  const dot = name.lastIndexOf(".");
  if (dot < 1) return undefined;
  const extension = name.slice(dot).toLowerCase() as AdminUploadExtension;
  return extension in adminUploadFormats ? extension : undefined;
}

function validateSegment(segment: string): FolderSelectionIssue | undefined {
  if (!segment) return issue("INVALID_PATH");
  if (segment === "." || segment === "..") return issue("PATH_TRAVERSAL");
  if (hasControlCharacter(segment)) return issue("CONTROL_CHARACTER");
  if (byteLength(segment) > folderUploadLimits.maxSegmentBytes) return issue("SEGMENT_TOO_LONG");
  return undefined;
}

/** Converts a browser folder-picker path into safe provenance metadata only. */
export function canonicalizeFolderRelativePath(browserRelativePath: string): CanonicalPathResult {
  if (!browserRelativePath) return { issue: issue("INVALID_PATH") };
  const normalized = browserRelativePath.replace(/\\/g, "/").normalize("NFC");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || /^file:\/\//i.test(normalized)) return { issue: issue("ABSOLUTE_PATH") };
  const segments = normalized.split("/");
  if (segments.length < 2) return { issue: issue("INVALID_PATH") };
  for (const segment of segments) {
    const failure = validateSegment(segment);
    if (failure) return { issue: failure };
  }
  const rootName = segments[0]!;
  try {
    const relative = validateCanonicalSourceRelativePath(segments.slice(1).join("/"));
    return { value: { rootName, ...relative } };
  } catch (error) {
    return { issue: error as FolderSelectionIssue };
  }
}

export function validateCanonicalSourceRelativePath(sourceRelativePath: string): CanonicalSourceRelativePath {
  if (!sourceRelativePath) throw issue("INVALID_PATH");
  const normalized = sourceRelativePath.replace(/\\/g, "/").normalize("NFC");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || /^file:\/\//i.test(normalized)) throw issue("ABSOLUTE_PATH");
  const segments = normalized.split("/");
  for (const segment of segments) {
    const failure = validateSegment(segment);
    if (failure) throw failure;
  }
  const directories = segments.slice(0, -1);
  if (directories.length > folderUploadLimits.maxDirectoryDepth) throw issue("PATH_TOO_DEEP");
  if (byteLength(normalized) > folderUploadLimits.maxRelativePathBytes) throw issue("PATH_TOO_LONG");
  return { relativePath: normalized, collisionKey: normalized.toLowerCase(), directories };
}

function validateFile(entry: FolderSelectionEntry): FolderSelectionIssue | undefined {
  if (!Number.isSafeInteger(entry.size) || entry.size < 1) return issue("EMPTY_FILE");
  if (entry.size > folderUploadLimits.maxFileBytes) return issue("FILE_TOO_LARGE");
  const extension = extensionFor(entry.name.normalize("NFC"));
  if (!extension) return issue("UNSUPPORTED_TYPE");
  const declared = entry.type?.split(";", 1)[0].trim().toLowerCase() ?? "";
  if (!declared) return undefined;
  const format = adminUploadFormats[extension];
  const compatible = "compatibleMimeTypes" in format && format.compatibleMimeTypes.some((mime) => mime === declared);
  if (declared !== format.mimeType && !compatible && !(format.content !== "text" && declared === "application/octet-stream")) return issue("INCONSISTENT_FILE_TYPE");
  return undefined;
}

function pathMatchesFileName(path: CanonicalPath, name: string) {
  const expected = name.normalize("NFC");
  return !expected.includes("/") && !expected.includes("\\") && path.relativePath.split("/").at(-1) === expected;
}

export function parseFolderSelection(entries: readonly FolderSelectionEntry[]): FolderSelectionManifest {
  const manifestIssues: FolderSelectionIssue[] = [];
  if (entries.length === 0) manifestIssues.push(issue("NO_FILES_SELECTED"));
  if (entries.length > folderUploadLimits.maxFiles) manifestIssues.push(issue("TOO_MANY_FILES"));
  const totalBytes = entries.reduce((total, entry) => total + (Number.isSafeInteger(entry.size) && entry.size > 0 ? entry.size : 0), 0);
  if (totalBytes > folderUploadLimits.maxTotalBytes) manifestIssues.push(issue("TOTAL_SIZE_EXCEEDED"));

  const roots = new Set<string>();
  const directories = new Set<string>();
  const collisionGroups = new Map<string, number[]>();
  const files = entries.map((entry, index): FolderSelectionFile => {
    const candidate: FolderSelectionFile = { index, name: entry.name.normalize("NFC"), size: entry.size, type: entry.type, originalRelativePath: entry.webkitRelativePath, issues: [] };
    const path = canonicalizeFolderRelativePath(entry.webkitRelativePath);
    if ("issue" in path) candidate.issues.push(path.issue);
    else if (!pathMatchesFileName(path.value, entry.name)) candidate.issues.push(issue("INVALID_PATH"));
    else {
      roots.add(path.value.rootName);
      candidate.relativePath = path.value.relativePath;
      candidate.collisionKey = path.value.collisionKey;
      for (let depth = 1; depth <= path.value.directories.length; depth += 1) directories.add(path.value.directories.slice(0, depth).join("/"));
      const collisions = collisionGroups.get(path.value.collisionKey) ?? [];
      collisions.push(index);
      collisionGroups.set(path.value.collisionKey, collisions);
    }
    const fileFailure = validateFile(entry);
    if (fileFailure) candidate.issues.push(fileFailure);
    return candidate;
  });
  if (roots.size > 1) manifestIssues.push(issue("MIXED_ROOTS"));
  for (const indexes of collisionGroups.values()) if (indexes.length > 1) for (const index of indexes) files[index]!.issues.push(issue("DUPLICATE_PATH"));
  if (directories.size > folderUploadLimits.maxUniqueDirectories) manifestIssues.push(issue("TOO_MANY_DIRECTORIES"));
  const rootName = roots.size === 1 ? [...roots][0]! : null;
  return { rootName, files, totalFiles: entries.length, totalBytes, uniqueDirectoryCount: directories.size, issues: manifestIssues, isValid: manifestIssues.length === 0 && files.every((file) => file.issues.length === 0) };
}
