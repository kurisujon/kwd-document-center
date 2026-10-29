# ADR-011: Dashboard Overview, Filtered Reports Export, Starred Documents, and Document QR Codes

## Context and Problem Statement

KWD Document Center requires records management utilities to improve day-to-day productivity for water district staff and administrators:
1. **Dashboard Overview:** Staff and administrators need quick situational awareness: how many total active records exist, which records are expiring soon, which records require legal retention disposition review, and breakdowns by document category.
2. **Reports & Exports:** Records officers and auditors need exportable reports of filtered registry subsets and printable inventories for official district records. Per project ground rules, no heavyweight, unapproved npm dependencies (such as vulnerable xlsx libraries) should be introduced.
3. **Starred / Bookmarked Records:** Users need personal bookmarking to track frequently referenced resolutions, memos, or active contracts.
4. **Physical Document Verification (QR Codes):** Physical printouts and binder records should have a verifiable QR code linking directly back to their official digital registry record at `/documents/[id]`, requiring authorized login to prevent public data exposure.
5. **Confidentiality:** Every metric, dashboard list, report export, and starred record query must strictly respect `can_read_document`. Non-admin users must never see confidential document counts or details.

## Decisions

### 1. Actionable Records Dashboard (`/dashboard`)
- A focused overview providing key operational metrics:
  - Total active documents.
  - Documents expiring within 90 days.
  - Documents flagged for retention review (`PENDING_REVIEW`).
  - Distribution breakdown by document type.
  - Quick tables: 5 most recent uploads and 5 upcoming expiring documents.
- Unlike generic SaaS analytics dashboards, this page contains zero decorative filler or fake analytics. Every metric is an active records query filtered by `can_read_document`.

### 2. Reports & RFC 4180 CSV Export (`/reports`)
- A dedicated report view allowing staff and administrators to filter records by document type, filing year, subcategory, and date range.
- **CSV Export:** Direct CSV stream adhering strictly to RFC 4180 with standard character escaping (RFC-compliant quoting, CRLF line endings, and utf-8 charset).
- **Print Stylesheet:** Custom `@media print` rules strip away web navigation, buttons, and scrims, producing clean, formal A4/Letter printed inventories for Commission on Audit (COA) or management reviews.
- Zero external spreadsheet libraries are added.

### 3. User Document Bookmarking (`user_document_stars`)
- Stored in `public.user_document_stars` with `unique (user_id, document_id)`.
- RLS ensures users can only view, create, and remove their own stars, with row insertion verifying `can_read_document`.
- Starred records view at `/documents/starred` with instant toggle buttons on document records.

### 4. Zero-Dependency SVG QR Code Generator
- QR code generation is implemented in pure TypeScript (`src/lib/qr/qr-generator.ts`) generating standard, clean SVG markup.
- Links to canonical URL `https://<host>/documents/<id>`.
- Target page enforces application authentication (`requireAuthorizedUser`), ensuring physical QR scans cannot be exploited by unauthorized third parties to bypass confidentiality.

### 5. Accessibility (WCAG 2.1 AA)
- All new views provide semantic headings, accessible tables, full keyboard navigability (Tab/Shift+Tab, Escape), and visible focus indicators.
- Loading states and error messages provide accessible ARIA live regions and alerts.

## Consequences
- **Positive:** Records officers gain instant status overviews and export capabilities without adding any third-party npm vulnerabilities; audit compliance is enhanced via physical QR linking.
- **Negative:** CSV export requires clients to open in Excel or Sheets rather than downloading native `.xlsx` files; however, this avoids known supply-chain security risks.
