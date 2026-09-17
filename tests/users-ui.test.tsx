import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DeactivationConfirmation,
  DeactivationConfirmationContent,
  UserManagement,
  UsersErrorState,
  UsersTable,
} from "../src/components/users/user-management.tsx";
import {
  createManagedUser,
  fetchManagedUsers,
  replaceManagedUser,
  updateManagedUser,
  UserManagementApiError,
  userManagementErrorMessage,
} from "../src/lib/users/client.ts";
import type { ManagedUser } from "../src/lib/users/types.ts";

const currentUser: ManagedUser = {
  id: "10000000-0000-4000-8000-000000000001",
  email: "admin@example.test",
  name: "Current Admin",
  role: "ADMIN",
  status: "ACTIVE",
  created_at: "2026-09-17T00:00:00+00:00",
  updated_at: "2026-09-17T00:00:00+00:00",
};

const staffUser: ManagedUser = {
  id: "20000000-0000-4000-8000-000000000002",
  email: "staff@example.test",
  name: "Staff User",
  role: "STAFF",
  status: "ACTIVE",
  created_at: "2026-09-17T00:00:00+00:00",
  updated_at: "2026-09-17T00:00:00+00:00",
};

const inactiveViewer: ManagedUser = {
  ...staffUser,
  id: "30000000-0000-4000-8000-000000000003",
  email: "viewer@example.test",
  name: "Viewer User",
  role: "VIEWER",
  status: "INACTIVE",
};

const noOp = () => {};

type InteractiveElementProps = {
  children?: React.ReactNode;
  disabled?: boolean;
  value?: string;
  onClick?: () => void;
  onChange?: (event: { target: { value: string } }) => void;
};

function findElement(node: React.ReactNode, predicate: (element: React.ReactElement<InteractiveElementProps>) => boolean): React.ReactElement<InteractiveElementProps> | undefined {
  if (!React.isValidElement<InteractiveElementProps>(node)) return undefined;
  if (predicate(node)) return node;
  for (const child of React.Children.toArray(node.props.children)) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return undefined;
}

test("Users table renders readable administration fields and protects the current administrator", () => {
  const html = renderToStaticMarkup(
    <UsersTable
      users={[currentUser, staffUser, inactiveViewer]}
      currentUserId={currentUser.id}
      onRoleChange={noOp}
      onStatusAction={noOp}
    />,
  );

  for (const value of [
    "Current Admin", "admin@example.test", "Admin", "Active",
    "Staff User", "staff@example.test", "Staff",
    "Viewer User", "viewer@example.test", "Viewer", "Inactive",
  ]) assert.match(html, new RegExp(value));

  assert.match(html, /This is your account\./);
  assert.match(html, /Protected account/);
  assert.match(html, /<select[^>]*disabled/);
  assert.match(html, />Deactivate<|>Deactivate<\/button>/);
  assert.match(html, />Reactivate<|>Reactivate<\/button>/);
  assert.doesNotMatch(html, /created_at|updated_at|2026-09-17/);
});

test("Users table and page expose clear empty and loading states", () => {
  const empty = renderToStaticMarkup(
    <UsersTable users={[]} currentUserId={currentUser.id} onRoleChange={noOp} onStatusAction={noOp} />,
  );
  assert.match(empty, /No authorized users found/);

  const loading = renderToStaticMarkup(<UserManagement currentUserId={currentUser.id} />);
  assert.match(loading, /Loading authorized users/);

  const error = renderToStaticMarkup(<UsersErrorState onRetry={noOp} />);
  assert.match(error, /Users unavailable/);
  assert.match(error, />Retry</);
  assert.doesNotMatch(error, /SQLSTATE|PL\/pgSQL|Supabase/);
});

test("Add User opens as a labeled form without an initial status control", () => {
  const html = renderToStaticMarkup(
    <UserManagement currentUserId={currentUser.id} initialUsers={[currentUser]} initialAddOpen />,
  );
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /Add authorized user/);
  assert.match(html, /name="name"/);
  assert.match(html, /name="email"/);
  assert.match(html, /name="role"/);
  assert.doesNotMatch(html, /name="status"/);
  assert.match(html, /maxlength="120"/i);
  assert.match(html, /maxlength="254"/i);
});

test("deactivation confirmation identifies the user and offers explicit keyboard controls", () => {
  const html = renderToStaticMarkup(
    <DeactivationConfirmation user={staffUser} pending={false} onCancel={noOp} onConfirm={noOp} />,
  );
  assert.match(html, /role="group"/);
  assert.match(html, /Deactivate Staff User\?/);
  assert.match(html, /staff@example\.test/);
  assert.match(html, />Cancel</);
  assert.match(html, /Deactivate user/);
});

test("actual deactivation controls reveal confirmation and PATCH INACTIVE only after confirmation", async () => {
  let selected: ManagedUser | undefined;
  const table = UsersTable({
    users: [currentUser, staffUser],
    currentUserId: currentUser.id,
    onRoleChange: noOp,
    onStatusAction: (user) => { selected = user; },
  });
  const deactivate = findElement(table, (element) => element.type === "button" && element.props.children === "Deactivate");
  assert.ok(deactivate?.props.onClick);
  deactivate.props.onClick();
  assert.equal(selected?.id, staffUser.id);

  let rows = [staffUser];
  let confirmationRequest: Promise<void> | undefined;
  let deactivationPayload: unknown;
  const confirmation = DeactivationConfirmationContent({
    user: selected as ManagedUser,
    pending: false,
    onCancel: noOp,
    onConfirm: () => {
      confirmationRequest = updateManagedUser(
        staffUser.id,
        { status: "INACTIVE" },
        async (_input, init) => {
          const payload = JSON.parse(String(init?.body)) as { status: "INACTIVE" };
          deactivationPayload = payload;
          return Response.json({ user: { ...staffUser, ...payload } });
        },
      ).then((result) => { rows = replaceManagedUser(rows, result.user); });
    },
  });
  const confirm = findElement(confirmation, (element) => element.type === "button" && element.props.children === "Deactivate user");
  assert.ok(confirm?.props.onClick);
  confirm.props.onClick();
  await confirmationRequest;
  assert.deepEqual(deactivationPayload, { status: "INACTIVE" });
  assert.equal(rows[0].status, "INACTIVE");
});

test("actual role control PATCHes only role and failed control interactions keep the displayed role", async () => {
  let rows = [staffUser];
  let roleRequest: Promise<void> | undefined;
  let rolePayload: unknown;
  const table = UsersTable({
    users: [currentUser, ...rows],
    currentUserId: currentUser.id,
    onStatusAction: noOp,
    onRoleChange: (user, role) => {
      roleRequest = updateManagedUser(
        user.id,
        { role },
        async (_input, init) => {
          const payload = JSON.parse(String(init?.body)) as { role: "VIEWER" };
          rolePayload = payload;
          return Response.json({ user: { ...user, ...payload } });
        },
      ).then((result) => { rows = replaceManagedUser(rows, result.user); });
    },
  });
  const roleSelect = findElement(table, (element) => element.type === "select" && element.props.value === "STAFF" && !element.props.disabled);
  assert.ok(roleSelect?.props.onChange);
  roleSelect.props.onChange({ target: { value: "VIEWER" } });
  await roleRequest;
  assert.deepEqual(rolePayload, { role: "VIEWER" });
  assert.equal(rows[0].role, "VIEWER");

  const beforeFailure = rows;
  const failedTable = UsersTable({
    users: [currentUser, ...rows],
    currentUserId: currentUser.id,
    onStatusAction: noOp,
    onRoleChange: (user, role) => {
      roleRequest = updateManagedUser(
        user.id,
        { role },
        async () => Response.json({ error: { code: "LAST_ACTIVE_ADMIN", message: "raw database context" } }, { status: 409 }),
      ).then((result) => { rows = replaceManagedUser(rows, result.user); }).catch(noOp);
    },
  });
  const failedRoleSelect = findElement(failedTable, (element) => element.type === "select" && element.props.value === "VIEWER" && !element.props.disabled);
  assert.ok(failedRoleSelect?.props.onChange);
  failedRoleSelect.props.onChange({ target: { value: "ADMIN" } });
  await roleRequest;
  assert.deepEqual(rows, beforeFailure);
});

test("browser API adapter loads users only through GET api/admin/users", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const result = await fetchManagedUsers(async (input, init) => {
    calls.push({ input: String(input), init });
    return Response.json({ users: [currentUser, staffUser] });
  });
  assert.deepEqual(result.users, [currentUser, staffUser]);
  assert.deepEqual(calls, [{ input: "/api/admin/users", init: { method: "GET", cache: "no-store" } }]);
});

test("Add User sends only email, name, and role and safely translates duplicates", async () => {
  let submitted: unknown;
  const created = await createManagedUser(
    { email: "person@example.test", name: "Person", role: "STAFF" },
    async (_input, init) => {
      submitted = JSON.parse(String(init?.body));
      return Response.json({ user: staffUser }, { status: 201 });
    },
  );
  assert.deepEqual(submitted, { email: "person@example.test", name: "Person", role: "STAFF" });
  assert.equal(created.user.id, staffUser.id);

  await assert.rejects(
    () => createManagedUser(
      { email: "person@example.test", name: "Person", role: "STAFF" },
      async () => Response.json({
        error: { code: "USER_ALREADY_EXISTS", message: "SQLSTATE raw duplicate details" },
      }, { status: 409 }),
    ),
    (error: unknown) => error instanceof UserManagementApiError
      && error.message === "This email is already authorized."
      && !error.message.includes("SQLSTATE"),
  );
});

test("role and status updates send exact PATCH payloads and do not mutate local rows on failure", async () => {
  const calls: Array<{ input: string; method?: string; body: unknown }> = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input: String(input), method: init?.method, body: JSON.parse(String(init?.body)) });
    return Response.json({ user: { ...staffUser, ...JSON.parse(String(init?.body)) } });
  };

  const roleResult = await updateManagedUser(staffUser.id, { role: "VIEWER" }, fetcher);
  const statusResult = await updateManagedUser(staffUser.id, { status: "INACTIVE" }, fetcher);
  assert.equal(roleResult.user.role, "VIEWER");
  assert.equal(statusResult.user.status, "INACTIVE");
  assert.deepEqual(calls, [
    { input: `/api/admin/users/${staffUser.id}`, method: "PATCH", body: { role: "VIEWER" } },
    { input: `/api/admin/users/${staffUser.id}`, method: "PATCH", body: { status: "INACTIVE" } },
  ]);

  const rows = [staffUser];
  await assert.rejects(
    () => updateManagedUser(staffUser.id, { role: "ADMIN" }, async () => Response.json({
      error: { code: "LAST_ACTIVE_ADMIN", message: "raw database context" },
    }, { status: 409 })),
    UserManagementApiError,
  );
  assert.deepEqual(rows, [staffUser], "failed requests must not replace the displayed row");

  const replaced = replaceManagedUser(rows, roleResult.user);
  assert.equal(replaced[0].role, "VIEWER");
  assert.equal(rows[0].role, "STAFF", "successful replacement must not mutate prior state");
});

test("known user-management errors always map to safe UI copy", () => {
  const expected = new Map([
    ["SELF_MODIFICATION_FORBIDDEN", "You cannot change your own role or deactivate your own account."],
    ["LAST_ACTIVE_ADMIN", "This change cannot be completed because at least one active administrator must remain."],
    ["USER_NOT_FOUND", "This user no longer exists. Refresh the list."],
    ["ADMIN_REQUIRED", "You no longer have permission to manage users."],
    ["FORBIDDEN", "You no longer have permission to manage users."],
    ["INTERNAL_ERROR", "Something went wrong. Try again."],
  ]);
  for (const [code, message] of expected) assert.equal(userManagementErrorMessage(code), message);
});

test("Users browser code uses only the server API and contains no privileged Supabase access", async () => {
  const component = await readFile(new URL("../src/components/users/user-management.tsx", import.meta.url), "utf8");
  const client = await readFile(new URL("../src/lib/users/client.ts", import.meta.url), "utf8");
  const browserCode = `${component}\n${client}`;

  assert.match(client, /["`]\/api\/admin\/users/);
  assert.match(client, /method: "POST"/);
  assert.match(client, /method: "PATCH"/);
  assert.doesNotMatch(browserCode, /supabase\/admin|createAdminClient|SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(browserCode, /\.from\(["']users["']\)|\.rpc\(/);
});
