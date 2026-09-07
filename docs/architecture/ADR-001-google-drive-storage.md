# Architecture Decision Record: Google Drive Storage

## Status
Accepted

## Context
KWD currently stores its digital documents in Google Drive. We need a system to make finding and uploading these documents easier. A standard web application approach might involve moving all files to a new object storage service (like AWS S3 or Supabase Storage).

## Decision
The actual document files will remain in Google Drive. The application will use the Google Drive API to upload new files and retrieve links/IDs for existing files.

## Consequences
- **Positive:** Leverages existing infrastructure. No migration of terabytes of historical files is required. Zero additional storage costs. Fits KWD's existing mental model.
- **Negative:** Requires handling Google Drive API authentication and permissions securely from the server.
