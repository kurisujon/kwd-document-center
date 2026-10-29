# UI Pages and Navigation

## 1. Core Pages [CONFIRMED]

### Login Page
- **Route**: `/login`
- **Purpose**: Authenticate the user via Google through Supabase.
- **Content**: KWD branding, "Continue with Google" button, brief application description.
- **Error states**: "You are not authorized" (for valid Google accounts not in the users table), "Account deactivated" (for INACTIVE users).
- **Redirect**: Authenticated users are redirected to `/documents`.

### Documents Page (Primary)
- **Route**: `/documents`
- **Purpose**: Primary document registry and search interface. This is the main authenticated experience.
- **Content**:
  - Prominent search input (the most important control on the page)
  - Document type filter (dropdown or tabs)
  - Date range filter
  - Results table with columns: Document Number, Type, Date, Subject, Actions
  - Sortable column headers
  - Pagination controls
  - "Upload Document" action button (visible to STAFF and ADMIN only)
- **Empty state**: "No documents found. Try adjusting your search or filters."
- **Loading state**: Skeleton table rows.
- **ADMIN deletion [PHASE 7A]**: Each document row includes a destructive
  Delete action. Its keyboard-accessible confirmation identifies the document
  and explains that the file moves to Google Drive Trash and disappears from
  the normal list. The control is absent for STAFF and VIEWER users, remains
  disabled while the request is in progress, and refreshes the list only after
  server confirmation.
- **ADMIN folder creation [PHASE 7C]**: An ADMIN-only Create folder action
  opens a labeled form for logical destination and one folder name. A readable
  destination preview precedes submission. STAFF and VIEWER users do not see
  the action; the server remains authoritative. No folder explorer, nested
  creation, rename, move, or folder upload is provided.

### Document Detail Page
- **Route**: `/documents/[id]`
- **Purpose**: View full document metadata and access the actual Drive file.
- **Content**:
  - Document metadata displayed clearly (type, number, date, subject, persons involved, upload date, uploaded by)
  - Primary action: "Open in Drive" button
  - Secondary action: "Download" button
  - Edit metadata button (STAFF who uploaded, or ADMIN)
  - Back to documents link
- **Error state**: "This document's file may have been moved or deleted from Google Drive."

### Upload Document Page
- **Route**: `/documents/upload`
- **Purpose**: Upload one or more documents and create independent registry entries.
- **Access**: STAFF, ADMIN only.
- **Content**:
  - Document type selector (required)
  - Metadata form fields (dynamic based on document type, but core fields always present):
    - Document number
    - Document date
    - Subject
    - Persons involved
  - Native multi-file picker (maximum 25 files)
  - Common destination/date/person defaults
  - Per-file metadata review and editing
  - Per-file file validation feedback (type, size)
  - Bulk date/person/default actions for selected rows
  - State-based upload progress, with at most three concurrent uploads
  - Retry Failed without resubmitting completed rows
  - Error state with clear retry guidance
- **Design**: A compact review table in the existing upload page, not a separate batch route or a giant multipart form.

### Users Page (Admin Only)
- **Route**: `/admin/users`
- **Purpose**: Manage authorized users and roles.
- **Access**: ADMIN only.
- **Content**:
  - Users table: Email, Name, Role, Status, Actions
  - Search by name/email and role/status filter bar
  - Add user form/modal: Email, Name, Role
  - Edit user: Change role, activate/deactivate
  - Confirmation for deactivation
- **No delete**: Users are deactivated, not deleted.

### Folders & Destinations Page (Admin Only) [PHASE 7C.2]
- **Route**: `/admin/folders`
- **Purpose**: Manage folder hierarchy and configure upload-enabled destination folders for the Folder Upload Center.
- **Access**: ADMIN only.
- **Content**:
  - Overview of registered folders across years and categories
  - Upload destination toggle (enables/disables `upload_enabled` per folder via `PATCH /api/admin/folders/upload-settings`)
  - Status filtering (All, Upload enabled, Upload disabled) and search
  - Quick actions for folder creation and hierarchy item management

## 2. Implemented Pages & Workspaces

The full system incorporates all 11 core and administrative workspaces:

- **Dashboard** (`/dashboard`): Metric cards, category distributions, recent uploads, and system health overview with resilient fallback.
- **Documents Page** (`/documents`): Primary searchable registry with bento grid layout, responsive filters, and safe schema fallback.
- **Starred Documents** (`/documents/starred`): Personal bookmarks queue.
- **Reports & Analytics** (`/reports`): Filtered inventory reports, CSV exports, and printable summaries.
- **Notifications** (`/notifications`): Real-time and persisted user notifications with unread badges.
- **Tasks & Approvals** (`/tasks`): Actionable queue for document review, administrative sign-off, or certification.
- **Upload Center** (`/documents/upload`): Single and batch document upload with pre-allocation and folder routing.
- **User Management** (`/admin/users`): Role and status administration.
- **Folder & Destination Manager** (`/admin/folders`): Folder hierarchy and destination enabling.
- **Trash Management** (`/admin/trash`): Soft-deleted records recovery and permanent purge controls.
- **Audit Log** (`/admin/audit-log`): Tamper-evident append-only audit trail with structured filtering.

## 3. Navigation & Visual Design

The primary sidebar navigation features clean, accessible SVG icons replacing previous text markers:

- **Dashboard**: Layout grid icon
- **Documents**: File text icon
- **Starred**: Star icon
- **Reports**: Bar chart icon
- **Notifications**: Bell icon
- **My Tasks**: Checkbox list icon
- **Upload Center**: Upload tray icon
- **User Access**: User silhouettes icon
- **Folders & Destinations**: Folder directory icon
- **Trash**: Trash can icon
- **Audit Log**: Shield checkmark icon

### Loading & Error Experience
- **Page-Level Skeleton Loading**: Every protected route includes a dedicated `loading.tsx` using CSS shimmering animations (`@keyframes skeleton-shimmer`) matching the structure of each page (headers, filter bars, metric cards, and tables).
- **Graceful Query Sanitization**: All database queries incorporate multi-tier fallbacks: if extended columns (e.g. from newer migrations) are pending on the production database, queries automatically fall back to base columns without throwing fatal 500 errors or showing broken registry states.

## 4. Routing Summary
| Route | Page | Access | Loading Skeleton |
|---|---|---|---|
| `/login` | Login | Public | Instant |
| `/dashboard` | Dashboard Metrics | Authenticated | `dashboard/loading.tsx` |
| `/documents` | Documents (search/browse) | Authenticated | `documents/loading.tsx` |
| `/documents/[id]` | Document Detail | Authenticated | `documents/[id]/loading.tsx` |
| `/documents/starred` | Starred Documents | Authenticated | `documents/starred/loading.tsx` |
| `/documents/upload` | Upload Document | STAFF, ADMIN | `documents/upload/loading.tsx` |
| `/reports` | Reports & Exports | Authenticated | `reports/loading.tsx` |
| `/notifications` | Notifications | Authenticated | `notifications/loading.tsx` |
| `/tasks` | Approval Tasks | STAFF, ADMIN | `tasks/loading.tsx` |
| `/admin/users` | User Management | ADMIN | `admin/users/loading.tsx` |
| `/admin/folders` | Folders & Destinations | ADMIN | `admin/folders/loading.tsx` |
| `/admin/trash` | Trash (Restore & Purge) | ADMIN | `admin/trash/loading.tsx` |
| `/admin/audit-log` | Append-Only Audit Log | ADMIN | `admin/audit-log/loading.tsx` |

## 5. Post-Login Redirect [PROPOSED]
- After login, redirect to `/documents` (NOT a dashboard).
- The Documents page is the primary experience.
