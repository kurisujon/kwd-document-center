import { listUserPendingTasks } from "@/lib/approvals/approval-service";
import { requireAuthorizedUser } from "@/lib/auth/server";
import { TasksView } from "@/components/approvals/tasks-view";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ApprovalTaskRecord } from "@/lib/documents/types";

export default async function TasksPage() {
  const user = await requireAuthorizedUser();
  let initialTasks: ApprovalTaskRecord[] = [];

  try {
    const adminClient = createAdminClient();
    initialTasks = await listUserPendingTasks(adminClient, user);
  } catch {
    initialTasks = [];
  }

  return <TasksView initialTasks={initialTasks} userRole={user.role} />;
}
