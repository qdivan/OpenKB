"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Shield,
  Trash2,
  UserPlus,
  Users,
  XCircle
} from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  activateAdminUser,
  ApiRequestError,
  createAdminPasswordReset,
  createAdminUser,
  getMe,
  isUnauthorized,
  listAdminUsers,
  listAuditLogs,
  revokeAdminUserSessions,
  setAdminUserTenantRole,
  softDeleteAdminUser,
  suspendAdminUser,
  updateAdminUser,
  type AdminUser,
  type AdminUserStatus,
  type AuditLogEntry,
  type TenantRole
} from "@/lib/openkb-api";

const USER_STATUSES: Array<AdminUserStatus | "all"> = [
  "all",
  "active",
  "pending_activation",
  "pending_email_verification",
  "suspended",
  "deleted"
];
const TENANT_ROLES: Array<TenantRole | "all"> = ["all", "system_admin", "tenant_admin", "member"];
const ROLE_OPTIONS: TenantRole[] = ["member", "tenant_admin", "system_admin"];

export function AdminUsersClient() {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [statusFilter, setStatusFilter] = useState<AdminUserStatus | "all">("all");
  const [roleFilter, setRoleFilter] = useState<TenantRole | "all">("all");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [resetLink, setResetLink] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newRole, setNewRole] = useState<TenantRole>("member");

  const activeUsers = useMemo(
    () => users.filter((user) => user.status === "active").length,
    [users]
  );
  const suspendedUsers = useMemo(
    () => users.filter((user) => user.status === "suspended").length,
    [users]
  );
  const systemAdmins = useMemo(
    () => users.filter((user) => user.tenantRole === "system_admin").length,
    [users]
  );

  useEffect(() => {
    void load();
  }, [roleFilter, statusFilter]);

  async function load(search = query) {
    setIsLoading(true);
    setMessage("");
    try {
      const [nextUsers, nextAuditLogs, me] = await Promise.all([
        listAdminUsers({
          status: statusFilter,
          role: roleFilter,
          query: search.trim() || undefined,
          limit: 120
        }),
        listAuditLogs({ limit: 20, action: "admin.user" }),
        getMe()
      ]);
      if (!me.roles.some((role) => role === "system_admin" || role === "tenant_admin")) {
        setMessage("Admin role is required.");
        return;
      }
      setUsers(nextUsers.items);
      setAuditLogs(nextAuditLogs.items);
    } catch (error) {
      handleError(error);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsCreating(true);
    setMessage("");
    setResetLink("");
    try {
      const result = await createAdminUser({
        email: newEmail.trim(),
        display_name: newDisplayName.trim() || undefined,
        tenant_role: newRole
      });
      setResetLink(result.reset_link);
      setNewEmail("");
      setNewDisplayName("");
      setNewRole("member");
      setMessage("User created. Send the reset link to let them set a password.");
      await load("");
    } catch (error) {
      handleError(error);
    } finally {
      setIsCreating(false);
    }
  }

  async function runUserAction(userId: string, action: () => Promise<unknown>, success: string) {
    setBusyUserId(userId);
    setMessage("");
    setResetLink("");
    try {
      const result = await action();
      if (
        result &&
        typeof result === "object" &&
        "reset_link" in result &&
        typeof result.reset_link === "string"
      ) {
        setResetLink(result.reset_link);
      }
      setMessage(success);
      await load();
    } catch (error) {
      handleError(error);
    } finally {
      setBusyUserId(null);
    }
  }

  function handleError(error: unknown) {
    if (isUnauthorized(error)) {
      router.replace("/login");
      return;
    }
    if (error instanceof ApiRequestError && error.status === 403) {
      setMessage(error.body.message || "Admin role is required.");
      return;
    }
    setMessage(error instanceof Error ? error.message : "Request failed.");
  }

  async function copyResetLink() {
    if (!resetLink) {
      return;
    }
    await navigator.clipboard.writeText(resetLink);
    setMessage("Reset link copied.");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase text-zinc-500">Admin</p>
          <h1 className="mt-1 text-2xl font-semibold">Users</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Create accounts, change tenant roles, revoke sessions, and review account audit logs.
          </p>
        </div>
        <button className="icon-button" onClick={() => void load()} title="Refresh" type="button">
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Metric icon={<Users />} label="Active" value={activeUsers} />
            <Metric icon={<Shield />} label="System admins" value={systemAdmins} />
            <Metric icon={<XCircle />} label="Suspended" value={suspendedUsers} />
          </div>

          <section className="rounded-md border border-zinc-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 p-3">
              <form
                className="flex min-w-0 flex-1 flex-wrap gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void load();
                }}
              >
                <div className="relative min-w-[220px] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
                  <input
                    className="h-9 w-full rounded-md border border-zinc-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-emerald-500"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search email or name"
                    value={query}
                  />
                </div>
                <select
                  className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm"
                  onChange={(event) =>
                    setStatusFilter(event.target.value as AdminUserStatus | "all")
                  }
                  value={statusFilter}
                >
                  {USER_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <select
                  className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm"
                  onChange={(event) => setRoleFilter(event.target.value as TenantRole | "all")}
                  value={roleFilter}
                >
                  {TENANT_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white"
                  type="submit"
                >
                  <Search className="h-4 w-4" />
                  Search
                </button>
              </form>
            </div>

            {isLoading ? (
              <div className="flex h-56 items-center justify-center text-sm text-zinc-500">
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                Loading users
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[960px] table-fixed text-left text-sm">
                  <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
                    <tr>
                      <th className="w-[260px] px-3 py-2 font-medium">User</th>
                      <th className="w-[150px] px-3 py-2 font-medium">Status</th>
                      <th className="w-[170px] px-3 py-2 font-medium">Tenant role</th>
                      <th className="w-[120px] px-3 py-2 font-medium">Sessions</th>
                      <th className="w-[320px] px-3 py-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <UserRow
                        busy={busyUserId === user.id}
                        key={user.id}
                        onActivate={() =>
                          void runUserAction(
                            user.id,
                            () => activateAdminUser(user.id),
                            "User activated."
                          )
                        }
                        onDelete={() => {
                          if (window.confirm(`Soft-delete ${user.email}?`)) {
                            void runUserAction(
                              user.id,
                              () => softDeleteAdminUser(user.id),
                              "User soft-deleted."
                            );
                          }
                        }}
                        onRename={() => {
                          const nextName = window.prompt("Display name", user.displayName);
                          if (nextName?.trim()) {
                            void runUserAction(
                              user.id,
                              () => updateAdminUser(user.id, { display_name: nextName.trim() }),
                              "Display name updated."
                            );
                          }
                        }}
                        onResetPassword={() =>
                          void runUserAction(
                            user.id,
                            () => createAdminPasswordReset(user.id),
                            "Password reset link generated."
                          )
                        }
                        onRevokeSessions={() =>
                          void runUserAction(
                            user.id,
                            () => revokeAdminUserSessions(user.id),
                            "Sessions revoked."
                          )
                        }
                        onRoleChange={(role) =>
                          void runUserAction(
                            user.id,
                            () => setAdminUserTenantRole(user.id, role),
                            "Tenant role updated."
                          )
                        }
                        onSuspend={() => {
                          if (window.confirm(`Suspend ${user.email}?`)) {
                            void runUserAction(
                              user.id,
                              () => suspendAdminUser(user.id),
                              "User suspended."
                            );
                          }
                        }}
                        user={user}
                      />
                    ))}
                  </tbody>
                </table>
                {users.length === 0 ? (
                  <div className="border-t border-zinc-200 p-8 text-center text-sm text-zinc-500">
                    No users match the current filters.
                  </div>
                ) : null}
              </div>
            )}
          </section>
        </section>

        <aside className="space-y-4">
          <Panel title="Create User" icon={<UserPlus className="h-4 w-4" />}>
            <form className="space-y-3" onSubmit={(event) => void handleCreateUser(event)}>
              <label className="block text-xs font-medium text-zinc-600">
                Email
                <input
                  className="mt-1 h-9 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-emerald-500"
                  onChange={(event) => setNewEmail(event.target.value)}
                  required
                  type="email"
                  value={newEmail}
                />
              </label>
              <label className="block text-xs font-medium text-zinc-600">
                Display name
                <input
                  className="mt-1 h-9 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-emerald-500"
                  onChange={(event) => setNewDisplayName(event.target.value)}
                  value={newDisplayName}
                />
              </label>
              <label className="block text-xs font-medium text-zinc-600">
                Tenant role
                <select
                  className="mt-1 h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm"
                  onChange={(event) => setNewRole(event.target.value as TenantRole)}
                  value={newRole}
                >
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white disabled:bg-zinc-400"
                disabled={isCreating}
                type="submit"
              >
                {isCreating ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <UserPlus className="h-4 w-4" />
                )}
                Create
              </button>
            </form>
          </Panel>

          {message ? (
            <div className="rounded-md border border-zinc-200 bg-white p-3 text-sm text-zinc-700">
              {message}
            </div>
          ) : null}

          {resetLink ? (
            <Panel title="Password Reset" icon={<RotateCcw className="h-4 w-4" />}>
              <p className="break-all rounded-md bg-zinc-100 p-2 font-mono text-xs text-zinc-700">
                {resetLink}
              </p>
              <button
                className="mt-3 inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800"
                onClick={() => void copyResetLink()}
                type="button"
              >
                <Copy className="h-4 w-4" />
                Copy link
              </button>
            </Panel>
          ) : null}

          <Panel title="Recent Audit" icon={<Shield className="h-4 w-4" />}>
            <div className="space-y-2">
              {auditLogs.map((log) => (
                <div key={log.id} className="rounded-md border border-zinc-200 p-2">
                  <p className="truncate text-xs font-medium text-zinc-900">{log.action}</p>
                  <p className="mt-1 truncate text-xs text-zinc-500">
                    {log.objectType ?? "-"} · {new Date(log.createdAt).toLocaleString()}
                  </p>
                </div>
              ))}
              {auditLogs.length === 0 ? (
                <p className="text-sm text-zinc-500">No account audit entries yet.</p>
              ) : null}
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function UserRow({
  busy,
  onActivate,
  onDelete,
  onRename,
  onResetPassword,
  onRevokeSessions,
  onRoleChange,
  onSuspend,
  user
}: {
  busy: boolean;
  onActivate: () => void;
  onDelete: () => void;
  onRename: () => void;
  onResetPassword: () => void;
  onRevokeSessions: () => void;
  onRoleChange: (role: TenantRole) => void;
  onSuspend: () => void;
  user: AdminUser;
}) {
  return (
    <tr className="border-b border-zinc-100 align-top last:border-b-0">
      <td className="px-3 py-3">
        <p className="truncate font-medium text-zinc-900">{user.displayName}</p>
        <p className="truncate text-xs text-zinc-500">{user.email}</p>
      </td>
      <td className="px-3 py-3">
        <StatusPill status={user.status} />
      </td>
      <td className="px-3 py-3">
        <select
          className="h-8 w-full rounded-md border border-zinc-300 bg-white px-2 text-xs"
          disabled={busy || user.status === "deleted"}
          onChange={(event) => onRoleChange(event.target.value as TenantRole)}
          value={user.tenantRole ?? "member"}
        >
          {ROLE_OPTIONS.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-3 text-zinc-700">{user.activeSessionCount}</td>
      <td className="px-3 py-3">
        <div className="flex flex-wrap gap-1.5">
          <ActionButton disabled={busy} onClick={onRename}>
            Rename
          </ActionButton>
          {user.status === "active" ? (
            <ActionButton disabled={busy} onClick={onSuspend}>
              Suspend
            </ActionButton>
          ) : (
            <ActionButton disabled={busy || user.status === "deleted"} onClick={onActivate}>
              Activate
            </ActionButton>
          )}
          <ActionButton disabled={busy || user.status === "deleted"} onClick={onResetPassword}>
            Reset
          </ActionButton>
          <ActionButton disabled={busy} onClick={onRevokeSessions}>
            Revoke
          </ActionButton>
          <ActionButton danger disabled={busy || user.status === "deleted"} onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </ActionButton>
        </div>
      </td>
    </tr>
  );
}

function StatusPill({ status }: { status: AdminUserStatus }) {
  const tone =
    status === "active"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "suspended" || status === "deleted"
        ? "border-red-200 bg-red-50 text-red-700"
        : "border-amber-200 bg-amber-50 text-amber-700";
  const icon =
    status === "active" ? (
      <CheckCircle2 className="h-3.5 w-3.5" />
    ) : status === "suspended" || status === "deleted" ? (
      <XCircle className="h-3.5 w-3.5" />
    ) : (
      <AlertTriangle className="h-3.5 w-3.5" />
    );
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${tone}`}>
      {icon}
      {status}
    </span>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-3">
      <div className="flex items-center gap-2 text-xs font-medium uppercase text-zinc-500">
        <span className="text-zinc-700 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Panel({ children, icon, title }: { children: ReactNode; icon: ReactNode; title: string }) {
  return (
    <section className="rounded-md border border-zinc-200 bg-white p-3">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <span className="text-zinc-600">{icon}</span>
        {title}
      </div>
      {children}
    </section>
  );
}

function ActionButton({
  children,
  danger,
  disabled,
  onClick
}: {
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs font-medium disabled:bg-zinc-100 ${
        danger
          ? "border-red-200 bg-white text-red-700 hover:bg-red-50"
          : "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50"
      }`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
