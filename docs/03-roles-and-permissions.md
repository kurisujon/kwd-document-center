# Roles and Permissions

## 1. Authentication vs Authorization [CONFIRMED]
Authentication will support Google Sign-in. Because KWD staff may use personal Gmail accounts, we **cannot** assume all users belong to a single Google Workspace domain.

**Workflow:**
1. User clicks "Continue with Google".
2. Google authenticates identity.
3. Application checks the authorized user list in Supabase.
4. Application checks assigned role/status.
5. Access is Allowed or Denied based on application records.

*Note: Google authentication proves identity. It does NOT automatically determine application authorization. The application must maintain its own authorized-user system.*

## 2. User Roles [PROPOSED]
The following role model is proposed and requires confirmation:

### ADMIN
**Abilities:**
- Manage users (create, update, activate/deactivate)
- Manage system configuration
- Manage document records (edit metadata, delete/archive if permitted)
- View documents
- Upload documents

### STAFF
**Abilities:**
- Upload documents
- Search and view documents
- Download documents
- Edit permitted metadata on documents they own/have access to

### VIEWER
**Abilities:**
- Search documents
- View document metadata
- Download/open actual documents

*Note: Do not silently convert these proposed roles into confirmed requirements. They must be reviewed.*

## 3. Security Principles [CONFIRMED]
- **Server-side authorization:** Never trust a client-provided role. Role checks must happen securely on the server.
- **Least-privilege access:** Users should only have access to what they need.
- **Protect administrative operations:** Ensure API routes for user management are strictly protected.
- **Unified document read gate (`can_read_document`):** Every document read path — RLS on `public.documents`, registry queries (`listDocuments`, `getDocumentById`, `listDocumentTypes`), and file access routes (`GET /api/documents/[id]/open`, `GET /api/documents/[id]/download`) — enforces the same access check. Documents with `confidential = true` are readable only by `ACTIVE` `ADMIN` users; `STAFF` and `VIEWER` users receive normal not-found responses and never see confidential records in lists or filter facets. Only an `ACTIVE` `ADMIN` can change `confidential` (`PATCH /api/documents/[id]` -> `public.admin_set_document_confidential`).
