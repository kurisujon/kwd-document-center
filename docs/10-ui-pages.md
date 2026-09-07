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
- **Purpose**: Upload a new document and create its registry entry.
- **Access**: STAFF, ADMIN only.
- **Content**:
  - Document type selector (required)
  - Metadata form fields (dynamic based on document type, but core fields always present):
    - Document number
    - Document date
    - Subject
    - Persons involved
  - File upload zone (drag & drop or file picker)
  - File validation feedback (type, size)
  - Submit button with loading state
  - Success confirmation with link to the new document
  - Error state with clear retry guidance
- **Design**: Simple vertical form. No multi-step wizard.

### Users Page (Admin Only)
- **Route**: `/admin/users`
- **Purpose**: Manage authorized users and roles.
- **Access**: ADMIN only.
- **Content**:
  - Users table: Email, Name, Role, Status, Actions
  - Add user form/modal: Email, Name, Role
  - Edit user: Change role, activate/deactivate
  - Confirmation for deactivation
- **No delete**: Users are deactivated, not deleted.

## 2. Pages NOT Needed for MVP [CONFIRMED]

- **Dashboard/Home page with analytics**: NOT needed. The Documents page IS the home page after login.
- **Settings/Configuration page**: NOT needed for MVP. Folder mappings are environment variables. [FUTURE]
- **Reports page**: NOT needed.
- **Notifications page**: NOT needed.

## 3. Navigation Structure [PROPOSED]

Minimal sidebar or top navigation:
```
KWD Document Center
────────────────────
Documents          (all authenticated users)
Upload             (STAFF, ADMIN)
────────────────────
Users              (ADMIN only)
```

- Active page indicated with Azure accent
- Admin section visually separated
- User profile/logout in header or bottom of sidebar
- Mobile: collapsible hamburger navigation

## 4. Routing Summary [PROPOSED]
| Route | Page | Access |
|---|---|---|
| `/login` | Login | Public |
| `/documents` | Documents (search/browse) | Authenticated |
| `/documents/[id]` | Document Detail | Authenticated |
| `/documents/upload` | Upload Document | STAFF, ADMIN |
| `/admin/users` | User Management | ADMIN |

## 5. Post-Login Redirect [PROPOSED]
- After login, redirect to `/documents` (NOT a dashboard).
- The Documents page is the primary experience.
