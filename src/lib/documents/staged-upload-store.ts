/**
 * In-memory store for files staged across route transitions (e.g. dropped on /documents
 * and consumed on /documents/upload).
 * Does not persist across full page reloads.
 */

let stagedFiles: File[] = [];

export const stagedUploadStore = {
  set(files: File[]): void {
    stagedFiles = [...files];
  },
  consume(): File[] {
    const files = stagedFiles;
    stagedFiles = [];
    return files;
  },
  peek(): readonly File[] {
    return stagedFiles;
  },
  clear(): void {
    stagedFiles = [];
  },
};
