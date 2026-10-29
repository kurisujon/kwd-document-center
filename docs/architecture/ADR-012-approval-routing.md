# ADR-012: Document Approval Workflows, Ordered Routing, and Tasks Management

## Context and Problem Statement

Kiblawan Water District requires strict administrative governance over official records:
1. **Document Verification & Multi-Stage Sign-off:** High-consequence documents (such as Board Resolutions, Memorandums, Procurement Contracts, and Office Orders) require sequential review and approval (e.g., Division Head review followed by General Manager certification).
2. **Preventing Out-of-Order Execution:** Approvals must strictly adhere to an ordered sequence. Step $k$ must never be approved or bypassed before step $k-1$ is officially completed.
3. **Role & Identity Authorization:** Only designated approvers (by specific user account or verified role such as ADMIN) can act on a step. Unauthorized users cannot sign off.
4. **My Tasks & Accountability:** Approvers require an actionable "My tasks" center to track pending sign-offs awaiting their action.
5. **Auditability & Legal Records Compliance:** All routing transitions, notes, approvals, and returns must be recorded in the append-only `audit_log`.
6. **Confidentiality:** Confidential documents in routing must be strictly hidden from any user who is not an administrator or designated approver.

## Decisions

### 1. Template Routes & Concrete Document Approval Steps
- `public.approval_routes`: Defines default approval sequence templates per document type (e.g. `CONTRACTS`, `MEMORANDUM`, `BOARD RESOLUTION`, `BAC`).
- `public.document_approval_steps`: Concrete sequential step instances created when an approval process begins for a document:
  - `step_number`: 1, 2, 3...
  - `title`: e.g., "Division Head Review", "General Manager Approval".
  - `approver_id` / `approver_role`: designates the specific user or role required.
  - `status`: `'PENDING'`, `'IN_PROGRESS'`, `'APPROVED'`, `'RETURNED'`.
  - `notes`: justification or return feedback.
  - `action_at` and `action_by`: timestamp and actor identity.

### 2. Strict Sequential Invariant (No Skipping)
- The database RPC `process_approval_action` enforces that step $k$ can only be approved if all steps $< k$ have status `'APPROVED'`.
- Submitting an approval when a preceding step is pending or returned raises an exception (`PRIOR_STEP_UNAPPROVED`), preventing any out-of-order execution or skipped approvals.

### 3. Automatic Lifecycle Status Transitions
- Starting an approval transitions the document from `'DRAFT'` to `'UNDER_REVIEW'`.
- When the final step in the sequence is approved, the system automatically transitions the document's status to `'APPROVED'`.
- If an approver returns a step (`RETURN`), the step is marked `'RETURNED'`, the document status remains `'UNDER_REVIEW'`, and feedback notes are preserved.

### 4. "My Tasks" Center (`/tasks`)
- A centralized dashboard view displaying all pending steps where the authenticated user is either the assigned `approver_id` or possesses the required `approver_role`.
- Respects `can_read_document` to prevent unauthorized viewers from learning about confidential records.

### 5. Full Audit Log Integration
- All workflow actions write immutable entries to `public.audit_log`:
  - `APPROVAL_ROUTE_START`
  - `APPROVAL_STEP_APPROVE`
  - `APPROVAL_STEP_RETURN`
- Notes and step identifiers are stored in structured metadata.

## Consequences
- **Positive:** Guarantees compliance with KWD internal routing rules; provides full accountability and auditable history on every document detail page.
- **Negative:** Documents cannot jump directly to `APPROVED` without completing the route steps or an explicit admin override.
