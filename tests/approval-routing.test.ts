import assert from "node:assert/strict";
import test from "node:test";
import {
  getApprovalRouteForType,
  getApprovalRoutes,
  getDocumentApprovalSteps,
  listUserPendingTasks,
  processApprovalDecision,
  startDocumentApproval,
} from "../src/lib/approvals/approval-service";
import type { AuthorizedUser } from "../src/lib/auth/types";
import type {
  ApprovalRouteTemplate,
  ApprovalTaskRecord,
  DocumentApprovalStepRecord,
} from "../src/lib/documents/types";

const dummyAdmin: AuthorizedUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@kwd.gov.ph",
  name: "District Admin",
  role: "ADMIN",
  status: "ACTIVE",
};

const dummyStaff: AuthorizedUser = {
  id: "00000000-0000-4000-8000-000000000002",
  email: "staff@kwd.gov.ph",
  name: "Records Officer",
  role: "STAFF",
  status: "ACTIVE",
};

const dummyViewer: AuthorizedUser = {
  id: "00000000-0000-4000-8000-000000000003",
  email: "viewer@kwd.gov.ph",
  name: "Public Viewer",
  role: "VIEWER",
  status: "ACTIVE",
};

test("getApprovalRoutes and getApprovalRouteForType fetch templates", async () => {
  const templates: ApprovalRouteTemplate[] = [
    {
      id: "route-1",
      document_type: "CONTRACTS",
      name: "Contract Review & Approval Route",
      description: "Three-stage procurement and legal review",
      steps: [
        { step_number: 1, title: "Division Head Review", role: "STAFF" },
        { step_number: 2, title: "Legal Clearance", role: "ADMIN" },
        { step_number: 3, title: "GM Final Approval", role: "ADMIN" },
      ],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "route-2",
      document_type: "MEMORANDUM",
      name: "District Memorandum Route",
      description: "Two-stage administrative review",
      steps: [
        { step_number: 1, title: "Originating Officer Verification", role: "STAFF" },
        { step_number: 2, title: "GM Sign-off", role: "ADMIN" },
      ],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const fakeSupabase = {
    from: (table: string) => {
      if (table === "approval_routes") {
        return {
          select: () => ({
            order: () => Promise.resolve({ data: templates, error: null }),
            eq: (_col: string, val: string) => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: templates.find((t) => t.document_type === val) || null,
                  error: null,
                }),
            }),
          }),
        };
      }
      return {};
    },
  };

  const allRoutes = await getApprovalRoutes(fakeSupabase as never);
  assert.equal(allRoutes.length, 2);
  assert.equal(allRoutes[0].document_type, "CONTRACTS");

  const contractRoute = await getApprovalRouteForType(fakeSupabase as never, "CONTRACTS");
  assert.ok(contractRoute);
  assert.equal(contractRoute?.name, "Contract Review & Approval Route");
  assert.equal(contractRoute?.steps.length, 3);

  const unknownRoute = await getApprovalRouteForType(fakeSupabase as never, "NON_EXISTENT");
  assert.equal(unknownRoute, null);
});

test("startDocumentApproval enforces role authorization and creates steps via RPC", async () => {
  const docId = "doc-100";

  // 1. Viewer cannot initiate approval route
  await assert.rejects(
    async () => {
      await startDocumentApproval({} as never, dummyViewer, docId);
    },
    {
      message: "Only Staff and Administrators may initiate an approval route.",
    },
  );

  // 2. Staff initiates approval route successfully
  const expectedSteps: DocumentApprovalStepRecord[] = [
    {
      id: "step-1",
      document_id: docId,
      step_number: 1,
      title: "Division Head Review",
      approver_id: null,
      approver_role: "STAFF",
      status: "IN_PROGRESS",
      notes: null,
      action_at: null,
      action_by: null,
      created_at: new Date().toISOString(),
    },
    {
      id: "step-2",
      document_id: docId,
      step_number: 2,
      title: "GM Approval",
      approver_id: null,
      approver_role: "ADMIN",
      status: "PENDING",
      notes: null,
      action_at: null,
      action_by: null,
      created_at: new Date().toISOString(),
    },
  ];

  let rpcCalledWith: Record<string, unknown> | null = null;
  const fakeSupabase = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "start_document_approval") {
        rpcCalledWith = args;
        return { data: expectedSteps, error: null };
      }
      return { data: null, error: { message: "unknown rpc" } };
    },
  };

  const steps = await startDocumentApproval(fakeSupabase as never, dummyStaff, docId);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].status, "IN_PROGRESS");
  assert.equal(steps[1].status, "PENDING");
  assert.deepEqual(rpcCalledWith, {
    p_actor_id: dummyStaff.id,
    p_document_id: docId,
    p_custom_steps: null,
  });
});

test("getDocumentApprovalSteps respects can_read_document confidentiality", async () => {
  const confidentialDocId = "doc-confidential";
  const publicDocId = "doc-public";

  const fakeSupabase = {
    from: (table: string) => {
      if (table === "documents") {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: () => {
                if (val === confidentialDocId) {
                  return Promise.resolve({
                    data: {
                      document_id: confidentialDocId,
                      deletion_state: "ACTIVE",
                      confidential: true,
                    },
                    error: null,
                  });
                }
                if (val === publicDocId) {
                  return Promise.resolve({
                    data: {
                      document_id: publicDocId,
                      deletion_state: "ACTIVE",
                      confidential: false,
                    },
                    error: null,
                  });
                }
                return Promise.resolve({ data: null, error: null });
              },
            }),
          }),
        };
      }
      if (table === "document_approval_steps") {
        return {
          select: () => ({
            eq: () => ({
              order: () =>
                Promise.resolve({
                  data: [
                    {
                      id: "step-1",
                      document_id: confidentialDocId,
                      step_number: 1,
                      title: "Initial Check",
                      approver_role: "STAFF",
                      status: "IN_PROGRESS",
                    },
                  ],
                  error: null,
                }),
            }),
          }),
        };
      }
      return {};
    },
  };

  // Staff cannot read steps of a confidential document
  const staffConfidentialSteps = await getDocumentApprovalSteps(
    fakeSupabase as never,
    dummyStaff,
    confidentialDocId,
  );
  assert.equal(staffConfidentialSteps.length, 0);

  // Admin CAN read steps of a confidential document
  const adminConfidentialSteps = await getDocumentApprovalSteps(
    fakeSupabase as never,
    dummyAdmin,
    confidentialDocId,
  );
  assert.equal(adminConfidentialSteps.length, 1);
  assert.equal(adminConfidentialSteps[0].step_number, 1);

  // Staff CAN read steps of a public document
  const staffPublicSteps = await getDocumentApprovalSteps(
    fakeSupabase as never,
    dummyStaff,
    publicDocId,
  );
  assert.equal(staffPublicSteps.length, 1);
});

test("processApprovalDecision enforces sequential invariant (no skipping)", async () => {
  // 1. Viewer rejected
  await assert.rejects(
    async () => {
      await processApprovalDecision({} as never, dummyViewer, "step-1", "APPROVE");
    },
    {
      message: "Only Staff and Administrators can perform approval actions.",
    },
  );

  // 2. Reject invalid action string
  await assert.rejects(
    async () => {
      await processApprovalDecision(
        {} as never,
        dummyStaff,
        "step-1",
        "REJECT_ARBITRARY" as never,
      );
    },
    {
      message: "Invalid action. Must be APPROVE or RETURN.",
    },
  );

  // 3. Skipping step invariant: Attempting to approve step 2 when step 1 is unapproved throws PRIOR_STEP_UNAPPROVED
  const fakeSupabaseSkipping = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "process_approval_action") {
        if (args.p_step_id === "step-2") {
          return {
            data: null,
            error: { message: "PRIOR_STEP_UNAPPROVED" },
          };
        }
      }
      return { data: null, error: { message: "unknown rpc" } };
    },
  };

  await assert.rejects(
    async () => {
      await processApprovalDecision(
        fakeSupabaseSkipping as never,
        dummyStaff,
        "step-2",
        "APPROVE",
      );
    },
    {
      message: "PRIOR_STEP_UNAPPROVED",
    },
  );

  // 4. Successful approval of intermediate step
  const fakeSupabaseSuccess = {
    rpc: async () => ({
      data: [
        {
          id: "step-1",
          document_id: "doc-1",
          step_number: 1,
          title: "Division Head Review",
          status: "APPROVED",
          notes: "Looks complete and compliant",
          document_status: "UNDER_REVIEW",
          is_completed: false,
        },
      ],
      error: null,
    }),
  };

  const result1 = await processApprovalDecision(
    fakeSupabaseSuccess as never,
    dummyStaff,
    "step-1",
    "APPROVE",
    "Looks complete and compliant",
  );
  assert.equal(result1.status, "APPROVED");
  assert.equal(result1.document_status, "UNDER_REVIEW");
  assert.equal(result1.is_completed, false);

  // 5. Final step auto-promotes document to APPROVED
  const fakeSupabaseFinal = {
    rpc: async () => ({
      data: [
        {
          id: "step-2",
          document_id: "doc-1",
          step_number: 2,
          title: "GM Approval",
          status: "APPROVED",
          notes: "Approved for publication",
          document_status: "APPROVED",
          is_completed: true,
        },
      ],
      error: null,
    }),
  };

  const result2 = await processApprovalDecision(
    fakeSupabaseFinal as never,
    dummyAdmin,
    "step-2",
    "APPROVE",
    "Approved for publication",
  );
  assert.equal(result2.status, "APPROVED");
  assert.equal(result2.document_status, "APPROVED");
  assert.equal(result2.is_completed, true);
});

test("processApprovalDecision handles return with feedback", async () => {
  const fakeSupabaseReturn = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      assert.equal(fn, "process_approval_action");
      assert.equal(args.p_action, "RETURN");
      assert.equal(args.p_notes, "Missing division budget certification appendix.");
      return {
        data: [
          {
            id: "step-1",
            document_id: "doc-1",
            step_number: 1,
            title: "Division Head Review",
            status: "RETURNED",
            notes: args.p_notes,
            document_status: "UNDER_REVIEW",
            is_completed: false,
          },
        ],
        error: null,
      };
    },
  };

  const returnResult = await processApprovalDecision(
    fakeSupabaseReturn as never,
    dummyStaff,
    "step-1",
    "RETURN",
    "Missing division budget certification appendix.",
  );
  assert.equal(returnResult.status, "RETURNED");
  assert.equal(returnResult.notes, "Missing division budget certification appendix.");
  assert.equal(returnResult.document_status, "UNDER_REVIEW");
  assert.equal(returnResult.is_completed, false);
});

test("listUserPendingTasks returns actionable tasks and enforces confidentiality", async () => {
  const allTasks: ApprovalTaskRecord[] = [
    {
      step_id: "task-1",
      document_id: "doc-pub-1",
      step_number: 1,
      step_title: "Staff Review",
      step_status: "IN_PROGRESS",
      approver_id: dummyStaff.id,
      approver_role: "STAFF",
      document_number: "MEMO-2026-001",
      document_type: "MEMORANDUM",
      subject: "Water Distribution Schedule",
      confidential: false,
      file_name: "memo.pdf",
      file_type: "application/pdf",
      document_status: "UNDER_REVIEW",
      created_at: new Date().toISOString(),
    },
    {
      step_id: "task-2",
      document_id: "doc-conf-1",
      step_number: 2,
      step_title: "GM Executive Sign-off",
      step_status: "IN_PROGRESS",
      approver_id: null,
      approver_role: "ADMIN",
      document_number: "RES-2026-009",
      document_type: "BOARD RESOLUTION",
      subject: "Executive Personnel Matter",
      confidential: true,
      file_name: "resolution.pdf",
      file_type: "application/pdf",
      document_status: "UNDER_REVIEW",
      created_at: new Date().toISOString(),
    },
  ];

  const fakeSupabase = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "get_user_approval_tasks") {
        if (args.p_actor_id === dummyAdmin.id) {
          return { data: allTasks, error: null };
        }
        if (args.p_actor_id === dummyStaff.id) {
          // In actual DB, confidential doc might not be returned, but if it is,
          // listUserPendingTasks filters it defensively
          return { data: allTasks, error: null };
        }
      }
      return { data: [], error: null };
    },
  };

  // Viewer receives empty tasks
  const viewerTasks = await listUserPendingTasks(fakeSupabase as never, dummyViewer);
  assert.equal(viewerTasks.length, 0);

  // Staff receives ONLY public tasks (confidential task-2 is filtered out)
  const staffTasks = await listUserPendingTasks(fakeSupabase as never, dummyStaff);
  assert.equal(staffTasks.length, 1);
  assert.equal(staffTasks[0].step_id, "task-1");
  assert.equal(staffTasks[0].confidential, false);

  // Admin receives all tasks including confidential task-2
  const adminTasks = await listUserPendingTasks(fakeSupabase as never, dummyAdmin);
  assert.equal(adminTasks.length, 2);
  assert.ok(adminTasks.some((t) => t.confidential === true));
});
