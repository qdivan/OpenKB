"use client";

import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Copy,
  Info,
  KeyRound,
  LoaderCircle,
  LogOut,
  Plus,
  Power,
  RefreshCw,
  RotateCcw,
  Search,
  Shield,
  Trash2,
  UserPlus,
  Users,
  X,
  XCircle
} from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";

import { useDialog } from "@/components/dialog-provider";
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
import { useI18n } from "@/lib/i18n-provider";

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
  const { t } = useI18n();
  const dialog = useDialog();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [statusFilter, setStatusFilter] = useState<AdminUserStatus | "all">("all");
  const [roleFilter, setRoleFilter] = useState<TenantRole | "all">("all");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [resetLink, setResetLink] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
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
        setMessage(t("Admin role is required."));
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
      setResetLink(result.setup_link ?? result.reset_link);
      setNewEmail("");
      setNewDisplayName("");
      setNewRole("member");
      setIsCreateOpen(false);
      setMessage(t("User created. A welcome setup email was queued or sent."));
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
      setMessage(error.body.message || t("Admin role is required."));
      return;
    }
    setMessage(error instanceof Error ? error.message : t("Request failed."));
  }

  async function copyResetLink() {
    if (!resetLink) {
      return;
    }
    await navigator.clipboard.writeText(resetLink);
    setMessage(t("Reset link copied."));
  }

  async function handleRenameUser(user: AdminUser) {
    const nextName = await dialog.requestTextInput({
      title: t("Rename user"),
      label: t("Display name"),
      defaultValue: user.displayName,
      confirmLabel: t("Rename")
    });
    if (!nextName) {
      return;
    }
    await runUserAction(
      user.id,
      () => updateAdminUser(user.id, { display_name: nextName }),
      t("Display name updated.")
    );
  }

  async function handleSuspendUser(user: AdminUser) {
    const shouldSuspend = await dialog.requestConfirmation({
      title: t("Suspend user"),
      description: t(
        "Suspend {email}? Login will be blocked and active sessions will be revoked, while existing permissions stay unchanged.",
        { email: user.email }
      ),
      confirmLabel: t("Suspend"),
      tone: "danger"
    });
    if (!shouldSuspend) {
      return;
    }
    await runUserAction(user.id, () => suspendAdminUser(user.id), t("User suspended."));
  }

  async function handleDeleteUser(user: AdminUser) {
    const shouldDelete = await dialog.requestConfirmation({
      title: t("Soft-delete user"),
      description: t(
        "Soft-delete {email}? Historical creator names stay unchanged, but this account's memberships, collaborators, tenant role, and sessions are removed.",
        { email: user.email }
      ),
      confirmLabel: t("Delete"),
      tone: "danger"
    });
    if (!shouldDelete) {
      return;
    }
    await runUserAction(user.id, () => softDeleteAdminUser(user.id), t("User soft-deleted."));
  }

  async function handleRevokeSessions(user: AdminUser) {
    const shouldRevoke = await dialog.requestConfirmation({
      title: t("Revoke sessions"),
      description: t(
        "Revoke active sessions for {email}? This only signs the user out and does not change account status or permissions.",
        { email: user.email }
      ),
      confirmLabel: t("Revoke")
    });
    if (!shouldRevoke) {
      return;
    }
    await runUserAction(user.id, () => revokeAdminUserSessions(user.id), t("Sessions revoked."));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase text-zinc-500">{t("Admin")}</p>
          <h1 className="mt-1 text-2xl font-semibold">{t("Users")}</h1>
          <p className="mt-1 text-sm text-zinc-600">
            {t(
              "Create accounts, change tenant roles, revoke sessions, and review account audit logs."
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="icon-button"
            onClick={() => void load()}
            title={t("Refresh")}
            type="button"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </button>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
            onClick={() => setIsCreateOpen(true)}
            type="button"
          >
            <Plus className="h-4 w-4" />
            {t("Create user")}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <section className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Metric icon={<Users />} label={t("Active")} value={activeUsers} />
            <Metric icon={<Shield />} label={t("System admins")} value={systemAdmins} />
            <Metric icon={<XCircle />} label={t("Suspended")} value={suspendedUsers} />
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
                    placeholder={t("Search email or name")}
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
                      {t(status)}
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
                      {t(role)}
                    </option>
                  ))}
                </select>
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white"
                  type="submit"
                >
                  <Search className="h-4 w-4" />
                  {t("Search")}
                </button>
              </form>
            </div>

            {isLoading ? (
              <div className="flex h-56 items-center justify-center text-sm text-zinc-500">
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                {t("Loading users")}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[840px] text-left text-sm">
                  <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">{t("User")}</th>
                      <th className="w-[150px] px-3 py-2 font-medium">{t("Status")}</th>
                      <th className="w-[170px] px-3 py-2 font-medium">{t("Tenant role")}</th>
                      <th className="w-[115px] px-3 py-2 font-medium">
                        <span className="inline-flex items-center gap-1">
                          {t("Sessions")}
                          <HelpTip text={t("Sessions help")} />
                        </span>
                      </th>
                      <th className="w-[270px] px-3 py-2 font-medium">
                        <span className="inline-flex items-center gap-1">
                          {t("Actions")}
                          <HelpTip text={t("User actions help")} />
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <UserRow
                        busy={busyUserId === user.id}
                        key={user.id}
                        onDelete={() => void handleDeleteUser(user)}
                        onRename={() => void handleRenameUser(user)}
                        onResetPassword={() =>
                          void runUserAction(
                            user.id,
                            () => createAdminPasswordReset(user.id),
                            t("Password reset link generated.")
                          )
                        }
                        onRevokeSessions={() => void handleRevokeSessions(user)}
                        onRoleChange={(role) =>
                          void runUserAction(
                            user.id,
                            () => setAdminUserTenantRole(user.id, role),
                            t("Tenant role updated.")
                          )
                        }
                        onStatusToggle={() =>
                          user.status === "active"
                            ? void handleSuspendUser(user)
                            : void runUserAction(
                                user.id,
                                () => activateAdminUser(user.id),
                                t("User activated.")
                              )
                        }
                        user={user}
                      />
                    ))}
                  </tbody>
                </table>
                {users.length === 0 ? (
                  <div className="border-t border-zinc-200 p-8 text-center text-sm text-zinc-500">
                    {t("No users match the current filters.")}
                  </div>
                ) : null}
              </div>
            )}
          </section>
        </section>

        <div className="space-y-4">
          {message ? (
            <div className="rounded-md border border-zinc-200 bg-white p-3 text-sm text-zinc-700">
              {message}
            </div>
          ) : null}

          {resetLink ? (
            <Panel title={t("Password setup / reset")} icon={<RotateCcw className="h-4 w-4" />}>
              <p className="break-all rounded-md bg-zinc-100 p-2 font-mono text-xs text-zinc-700">
                {resetLink}
              </p>
              <button
                className="mt-3 inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800"
                onClick={() => void copyResetLink()}
                type="button"
              >
                <Copy className="h-4 w-4" />
                {t("Copy link")}
              </button>
            </Panel>
          ) : null}

          <Panel title={t("Recent Audit")} icon={<Shield className="h-4 w-4" />}>
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
                <p className="text-sm text-zinc-500">{t("No account audit entries yet.")}</p>
              ) : null}
            </div>
          </Panel>
        </div>
      </div>

      {isCreateOpen ? (
        <CreateUserDialog
          displayName={newDisplayName}
          email={newEmail}
          isCreating={isCreating}
          onClose={() => setIsCreateOpen(false)}
          onDisplayNameChange={setNewDisplayName}
          onEmailChange={setNewEmail}
          onRoleChange={setNewRole}
          onSubmit={handleCreateUser}
          role={newRole}
        />
      ) : null}
    </div>
  );
}

function UserRow({
  busy,
  onDelete,
  onRename,
  onResetPassword,
  onRevokeSessions,
  onRoleChange,
  onStatusToggle,
  user
}: {
  busy: boolean;
  onDelete: () => void;
  onRename: () => void;
  onResetPassword: () => void;
  onRevokeSessions: () => void;
  onRoleChange: (role: TenantRole) => void;
  onStatusToggle: () => void;
  user: AdminUser;
}) {
  const { t } = useI18n();
  return (
    <tr className="border-b border-zinc-100 align-top last:border-b-0">
      <td className="px-3 py-3">
        <p className="truncate font-medium text-zinc-900">{user.displayName}</p>
        <p className="truncate text-xs text-zinc-500">{user.email}</p>
      </td>
      <td className="px-3 py-3">
        <StatusActionButton busy={busy} onClick={onStatusToggle} status={user.status} />
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
              {t(role)}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-3 text-zinc-700">{user.activeSessionCount}</td>
      <td className="px-3 py-3">
        <div className="flex flex-wrap gap-1.5">
          <ActionButton disabled={busy} onClick={onRename}>
            {t("Rename")}
          </ActionButton>
          <ActionButton disabled={busy || user.status === "deleted"} onClick={onResetPassword}>
            <KeyRound className="h-3.5 w-3.5" />
            {t("Reset password")}
          </ActionButton>
          <ActionButton disabled={busy} onClick={onRevokeSessions}>
            <LogOut className="h-3.5 w-3.5" />
            {t("Revoke sessions short")}
          </ActionButton>
          <ActionButton danger disabled={busy || user.status === "deleted"} onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
            {t("Delete")}
          </ActionButton>
        </div>
      </td>
    </tr>
  );
}

function StatusActionButton({
  busy,
  onClick,
  status
}: {
  busy: boolean;
  onClick: () => void;
  status: AdminUserStatus;
}) {
  const { t } = useI18n();
  const disabled = busy || status === "deleted";
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
  const actionIcon =
    status === "active" ? (
      <Ban className="h-3.5 w-3.5" />
    ) : status === "deleted" ? null : (
      <Power className="h-3.5 w-3.5" />
    );

  return (
    <button
      className={`inline-flex min-w-[96px] items-center justify-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-70 ${tone}`}
      disabled={disabled}
      onClick={onClick}
      title={status === "active" ? t("Click to suspend") : t("Click to activate")}
      type="button"
    >
      {icon}
      {t(status)}
      {actionIcon}
    </button>
  );
}

function CreateUserDialog({
  displayName,
  email,
  isCreating,
  onClose,
  onDisplayNameChange,
  onEmailChange,
  onRoleChange,
  onSubmit,
  role
}: {
  displayName: string;
  email: string;
  isCreating: boolean;
  onClose: () => void;
  onDisplayNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onRoleChange: (value: TenantRole) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  role: TenantRole;
}) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/30 px-4 py-6">
      <form
        aria-modal="true"
        className="w-full max-w-md rounded-md border border-zinc-200 bg-white shadow-xl"
        onSubmit={onSubmit}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-emerald-700" />
              <h2 className="text-base font-semibold text-zinc-950">{t("Create user")}</h2>
            </div>
            <p className="mt-1 text-sm leading-6 text-zinc-500">{t("Create user dialog help")}</p>
          </div>
          <button aria-label={t("Close")} className="icon-button" onClick={onClose} type="button">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <label className="block text-sm font-medium text-zinc-700">
            <span className="mb-1 block">{t("Email")}</span>
            <input
              autoFocus
              className="h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              onChange={(event) => onEmailChange(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label className="block text-sm font-medium text-zinc-700">
            <span className="mb-1 block">{t("Display name")}</span>
            <input
              className="h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              onChange={(event) => onDisplayNameChange(event.target.value)}
              value={displayName}
            />
          </label>
          <label className="block text-sm font-medium text-zinc-700">
            <span className="mb-1 block">{t("Tenant role")}</span>
            <select
              className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              onChange={(event) => onRoleChange(event.target.value as TenantRole)}
              value={role}
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {t(option)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-200 px-5 py-4">
          <button
            className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            onClick={onClose}
            type="button"
          >
            {t("Cancel")}
          </button>
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:bg-emerald-300"
            disabled={isCreating}
            type="submit"
          >
            {isCreating ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            {t("Create user")}
          </button>
        </div>
      </form>
    </div>
  );
}

function HelpTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-zinc-300 bg-white text-[10px] text-zinc-500 hover:border-sky-300 hover:text-sky-700"
        type="button"
      >
        <Info className="h-3 w-3" />
      </button>
      <span className="pointer-events-none absolute left-1/2 top-5 z-20 w-64 -translate-x-1/2 rounded-md border border-zinc-200 bg-white p-2 text-xs normal-case leading-5 text-zinc-600 opacity-0 shadow-lg transition group-focus-within:opacity-100 group-hover:opacity-100">
        {text}
      </span>
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
