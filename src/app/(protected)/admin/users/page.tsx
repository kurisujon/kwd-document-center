import { UserManagement } from "@/components/users/user-management";
import { requireRole } from "@/lib/auth/server";

export default async function UsersPage() {
  const user = await requireRole("ADMIN");
  return <UserManagement currentUserId={user.id} />;
}
