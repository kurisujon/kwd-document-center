# Requirements & Pending Questions

## 1. Requirement Classification Definitions
Every important statement in this project must be classified as:
- **[CONFIRMED]**: Explicitly provided/approved.
- **[PROPOSED]**: Recommended design or architecture that still requires approval.
- **[ASSUMPTION]**: Temporary assumption made to continue planning.
- **[PENDING CONFIRMATION]**: Information that must come from KWD before final implementation.
- **[FUTURE]**: Not part of the initial implementation.

## 2. Core Features [CONFIRMED]
- **Authentication:** Google Sign-in with application-level authorization.
- **Document Search:** Global search, filtering, and sorting against the document registry.
- **Document Upload:** Single-page interface to upload files and input metadata.
- **Document Viewing:** Clean detail page to view metadata and access the actual Drive file.
- **User Management:** Admin controls to manage authorized users and roles.

## 3. Document Types [PROPOSED]
Initial categories (requires review against existing trackers):
- Memorandum
- Board Resolution
- BAC Resolution
- Annual Report
- Office Order
- Letter
- Meeting Minutes
- Other Documents

## 4. Pending Business Questions [PENDING CONFIRMATION]

### Google Drive
- What exact Drive account owns the files?
- Is the organization using My Drive or Shared Drive?
- What is the root folder?
- What folder structure should be used? (e.g., separated by type, year, or department?)
- What naming convention should be used?

### Existing Google Sheets Trackers / Future Integration
- Which trackers currently exist?
- Which columns does each tracker contain, and which are mandatory?
- Should existing trackers be consolidated?
- Should the application maintain one unified registry? (Recommended)

### Documents
- What are the final document types and required metadata per type?
- What file formats are allowed, and what is the maximum file size?
- What is the duplicate policy?
- Can users edit metadata, replace files, or delete records? Is versioning required?

### Users & Security
- Who are the authorized users?
- Who manages users, and what roles are required for uploading, editing, and deleting?
- How should Google Drive permissions work natively? Should users access files *only* through the application?
- What happens when a staff member leaves?
