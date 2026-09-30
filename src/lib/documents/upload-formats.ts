export const adminUploadAccept = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.jpg,.jpeg,.png,.txt";

const zipSignatures = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
] as const;

export const adminUploadFormats = {
  ".pdf": { mimeType: "application/pdf", signatures: [[0x25, 0x50, 0x44, 0x46]], content: "signature" },
  ".doc": { mimeType: "application/msword", signatures: [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]], content: "ole", markers: ["WordDocument"] },
  ".docx": { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", signatures: zipSignatures, content: "zip", markers: ["word/document.xml"] },
  ".xls": { mimeType: "application/vnd.ms-excel", signatures: [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]], content: "ole", markers: ["Workbook", "Book"] },
  ".xlsx": { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", signatures: zipSignatures, content: "zip", markers: ["xl/workbook.xml"] },
  ".csv": { mimeType: "text/csv", compatibleMimeTypes: ["application/vnd.ms-excel"], signatures: [], content: "text" },
  ".ppt": { mimeType: "application/vnd.ms-powerpoint", signatures: [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]], content: "ole", markers: ["PowerPoint Document"] },
  ".pptx": { mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", signatures: zipSignatures, content: "zip", markers: ["ppt/presentation.xml"] },
  ".jpg": { mimeType: "image/jpeg", signatures: [[0xff, 0xd8, 0xff]], content: "signature" },
  ".jpeg": { mimeType: "image/jpeg", signatures: [[0xff, 0xd8, 0xff]], content: "signature" },
  ".png": { mimeType: "image/png", signatures: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]], content: "signature" },
  ".txt": { mimeType: "text/plain", signatures: [], content: "text" },
} as const;

export type AdminUploadExtension = keyof typeof adminUploadFormats;
