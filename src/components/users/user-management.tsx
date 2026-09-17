"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { roles, type Role, type UserStatus } from "@/lib/auth/types";
import {
  addManagedUser,
  createManagedUser,
  fetchManagedUsers,
  replaceManagedUser,
  updateManagedUser,
  UserManagementApiError,
} from "@/lib/users/client";
import type { ManagedUser } from "@/lib/users/types";
import { createUserSchema } from "@/lib/users/validation";

const roleLabels: Record<Role, string> = {
  ADMIN: "Admin",
  STAFF: "Staff",
  VIEWER: "Viewer",
};

const statusLabels: Record<UserStatus, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
};

function safeError(error: unknown) {
  return error instanceof UserManagementApiError
    ? error.message
    : "Something went wrong. Try again.";
}

export function UsersLoadingState() {
  return <section className="users-state" role="status" aria-live="polite">Loading authorized users…</section>;
}

export function UsersErrorState({ onRetry, message = "We could not load authorized users. Try again." }: { onRetry: () => void; message?: string }) {
  return <section className="users-state users-state-error" role="alert"><h2>Users unavailable</h2><p>{message}</p><button className="button button-secondary" type="button" onClick={onRetry}>Retry</button></section>;
}

type UsersTableProps = {
  users: ManagedUser[];
  currentUserId: string;
  pendingUserId?: string;
  onRoleChange: (user: ManagedUser, role: Role) => void;
  onStatusAction: (user: ManagedUser) => void;
};

export function UsersTable({ users, currentUserId, pendingUserId, onRoleChange, onStatusAction }: UsersTableProps) {
  return <section className="table-wrap users-table-wrap" aria-label="Authorized users"><table className="users-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>{users.length === 0 ? <tr><td colSpan={5} className="empty-state"><strong>No authorized users found.</strong><span>Add a user to grant access to KWD Document Center.</span></td></tr> : users.map((user) => {
    const isCurrent = user.id === currentUserId;
    const pending = user.id === pendingUserId;
    return <tr key={user.id}><td><span className="user-name">{user.name}</span>{isCurrent && <span className="current-user-label">This is your account.</span>}</td><td className="user-email">{user.email}</td><td><label><span className="sr-only">Role for {user.name}</span><select className="table-select" value={user.role} disabled={isCurrent || pending} onChange={(event) => onRoleChange(user, event.target.value as Role)} aria-describedby={isCurrent ? "current-user-role-note" : undefined}>{roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label>{isCurrent && <span id="current-user-role-note" className="sr-only">Your own role cannot be changed.</span>}</td><td><span className={`status-badge status-${user.status.toLowerCase()}`}>{statusLabels[user.status]}</span></td><td>{isCurrent ? <span className="self-action">Protected account</span> : <button className="button button-secondary table-button" type="button" disabled={pending} onClick={() => onStatusAction(user)}>{pending ? "Saving…" : user.status === "ACTIVE" ? "Deactivate" : "Reactivate"}</button>}</td></tr>;
  })}</tbody></table></section>;
}

type DeactivationConfirmationProps = {
  user: ManagedUser;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeactivationConfirmationContent({ user, pending, onCancel, onConfirm, cancelRef }: DeactivationConfirmationProps & { cancelRef?: React.RefObject<HTMLButtonElement | null> }) {
  return <section className="confirmation-panel" role="group" aria-labelledby="deactivate-title" aria-describedby="deactivate-description" onKeyDown={(event) => { if (event.key === "Escape" && !pending) onCancel(); }}><div><h2 id="deactivate-title">Deactivate {user.name}?</h2><p id="deactivate-description"><strong>{user.email}</strong> will no longer be authorized to access KWD Document Center.</p></div><div className="confirmation-actions"><button ref={cancelRef} className="button button-secondary" type="button" disabled={pending} onClick={onCancel}>Cancel</button><button className="button button-danger" type="button" disabled={pending} onClick={onConfirm}>{pending ? "Deactivating…" : "Deactivate user"}</button></div></section>;
}

export function DeactivationConfirmation({ user, pending, onCancel, onConfirm }: DeactivationConfirmationProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancelRef.current?.focus(); }, []);

  return <DeactivationConfirmationContent user={user} pending={pending} onCancel={onCancel} onConfirm={onConfirm} cancelRef={cancelRef} />;
}

export function UserManagement({ currentUserId, initialUsers, initialAddOpen = false }: {
  currentUserId: string;
  initialUsers?: ManagedUser[];
  initialAddOpen?: boolean;
}) {
  const [users, setUsers] = useState<ManagedUser[]>(initialUsers ?? []);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(initialUsers ? "ready" : "loading");
  const [loadError, setLoadError] = useState<string>();
  const [addOpen, setAddOpen] = useState(initialAddOpen);
  const [adding, setAdding] = useState(false);
  const [pendingUserId, setPendingUserId] = useState<string>();
  const [confirmUserId, setConfirmUserId] = useState<string>();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();

  const loadUsers = useCallback(async () => {
    setLoadState("loading");
    setLoadError(undefined);
    setError(undefined);
    try {
      const result = await fetchManagedUsers();
      setUsers(result.users);
      setLoadState("ready");
    } catch (caught) {
      setLoadError(safeError(caught));
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    if (initialUsers !== undefined) return;
    let active = true;
    void fetchManagedUsers().then((result) => {
      if (!active) return;
      setUsers(result.users);
      setLoadState("ready");
    }).catch((caught) => {
      if (active) {
        setLoadError(safeError(caught));
        setLoadState("error");
      }
    });
    return () => { active = false; };
  }, [initialUsers]);

  function clearFeedback() {
    setError(undefined);
    setSuccess(undefined);
  }

  async function addUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const validation = createUserSchema.safeParse({
      name: formData.get("name"),
      email: formData.get("email"),
      role: formData.get("role"),
    });
    clearFeedback();
    if (!validation.success) {
      setError(validation.error.issues[0]?.message ?? "Check the entered information and try again.");
      return;
    }

    setAdding(true);
    try {
      const result = await createManagedUser(validation.data);
      setUsers((current) => addManagedUser(current, result.user));
      form.reset();
      setAddOpen(false);
      setSuccess(`${result.user.name} is now authorized.`);
    } catch (caught) {
      setError(safeError(caught));
    } finally {
      setAdding(false);
    }
  }

  async function changeUser(user: ManagedUser, input: { role?: Role; status?: UserStatus }, successMessage: string) {
    clearFeedback();
    setPendingUserId(user.id);
    try {
      const result = await updateManagedUser(user.id, input);
      setUsers((current) => replaceManagedUser(current, result.user));
      setSuccess(successMessage);
    } catch (caught) {
      setError(safeError(caught));
    } finally {
      setPendingUserId(undefined);
    }
  }

  function changeRole(user: ManagedUser, role: Role) {
    if (user.id === currentUserId || role === user.role) return;
    void changeUser(user, { role }, `${user.name}'s role was updated to ${roleLabels[role]}.`);
  }

  function statusAction(user: ManagedUser) {
    if (user.id === currentUserId) return;
    if (user.status === "ACTIVE") {
      clearFeedback();
      setConfirmUserId(user.id);
      return;
    }
    void changeUser(user, { status: "ACTIVE" }, `${user.name} was reactivated.`);
  }

  const confirmUser = users.find((user) => user.id === confirmUserId);

  return <><header className="page-heading"><div><h1>Users</h1><p>Manage the people authorized to access KWD Document Center.</p></div><button className="button button-primary" type="button" aria-expanded={addOpen} aria-controls="add-user-panel" onClick={() => { clearFeedback(); setAddOpen((open) => !open); }}>{addOpen ? "Close form" : "Add user"}</button></header>{addOpen && <section id="add-user-panel" className="user-form-panel" aria-labelledby="add-user-title"><div className="section-heading"><h2 id="add-user-title">Add authorized user</h2><p>They can sign in with this Google email after being added.</p></div><form className="user-form" onSubmit={addUser}><label className="field">Name<input name="name" autoComplete="name" maxLength={120} required disabled={adding} /></label><label className="field">Email<input name="email" type="email" autoComplete="email" maxLength={254} required disabled={adding} /></label><label className="field">Role<select name="role" defaultValue="" required disabled={adding}><option value="" disabled>Select a role</option>{roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label><div className="form-actions"><button className="button button-primary" type="submit" disabled={adding}>{adding ? "Adding…" : "Add user"}</button><button className="button button-secondary" type="button" disabled={adding} onClick={() => setAddOpen(false)}>Cancel</button></div></form></section>}{error && <div className="form-error users-feedback" role="alert">{error}</div>}{success && <div className="form-success users-feedback" role="status">{success}</div>}{loadState === "loading" ? <UsersLoadingState /> : loadState === "error" ? <UsersErrorState message={loadError} onRetry={() => void loadUsers()} /> : <UsersTable users={users} currentUserId={currentUserId} pendingUserId={pendingUserId} onRoleChange={changeRole} onStatusAction={statusAction} />}{confirmUser && <DeactivationConfirmation user={confirmUser} pending={pendingUserId === confirmUser.id} onCancel={() => setConfirmUserId(undefined)} onConfirm={() => { setConfirmUserId(undefined); void changeUser(confirmUser, { status: "INACTIVE" }, `${confirmUser.name} was deactivated.`); }} />}</>;
}
