"use client";

import {
  Check,
  Clock3,
  MailPlus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRound,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useDialog } from "@/components/dialog-provider";
import { useI18n } from "@/lib/i18n-provider";
import {
  ApiRequestError,
  acceptInvitation,
  approveInvitation,
  createInvitation,
  deleteCollaborator,
  deleteWorkspaceMember,
  listCollaborators,
  listInvitations,
  listWorkspaceMembers,
  revokeInvitation,
  updateCollaborator,
  updateWorkspaceMember,
  type AccessObjectType,
  type Collaborator,
  type CollaboratorRole,
  type Invitation,
  type InvitationRole,
  type WorkspaceMember,
  type WorkspaceMemberRole
} from "@/lib/openkb-api";

export type AccessTarget = {
  type: AccessObjectType;
  id: string;
  title: string;
  subtitle: string;
};

export function AccessPanel({
  initialTargetType,
  onClose,
  targets
}: {
  initialTargetType: AccessObjectType;
  onClose: () => void;
  targets: AccessTarget[];
}) {
  const { t } = useI18n();
  const dialog = useDialog();
  const [targetType, setTargetType] = useState<AccessObjectType>(initialTargetType);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitationRole>("viewer");
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [maxUses, setMaxUses] = useState("1");
  const [expiresAt, setExpiresAt] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const target = useMemo(
    () => targets.find((item) => item.type === targetType) ?? targets[0] ?? null,
    [targetType, targets]
  );
  const isWorkspace = target?.type === "workspace";
  const roleOptions = isWorkspace
    ? (["admin", "member", "guest"] as const)
    : (["manager", "editor", "viewer"] as const);

  useEffect(() => {
    setTargetType(initialTargetType);
  }, [initialTargetType]);

  useEffect(() => {
    setRole((target?.type === "workspace" ? "member" : "viewer") as InvitationRole);
  }, [target?.type]);

  useEffect(() => {
    if (!target) {
      return;
    }
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id, target?.type]);

  async function refresh() {
    if (!target) {
      return;
    }
    setIsLoading(true);
    setMessage("");
    try {
      const [nextInvitations, nextAccess] = await Promise.all([
        listInvitations(target.type, target.id),
        target.type === "workspace"
          ? listWorkspaceMembers(target.id)
          : listCollaborators(target.type, target.id)
      ]);
      setInvitations(nextInvitations);
      if (target.type === "workspace") {
        setMembers(nextAccess as WorkspaceMember[]);
        setCollaborators([]);
      } else {
        setCollaborators(nextAccess as Collaborator[]);
        setMembers([]);
      }
    } catch (error) {
      setMessage(formatError(error, t("Failed to load access settings.")));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateInvitation() {
    if (!target || !email.trim()) {
      setMessage(t("Invite email is required."));
      return;
    }
    setIsSaving(true);
    setMessage("");
    try {
      const invitation = await createInvitation(target.type, target.id, {
        email: email.trim(),
        role,
        require_approval: requiresApproval,
        max_uses: maxUses ? Number(maxUses) : null,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null
      });
      const link = `${window.location.origin}/invite/${invitation.token ?? ""}`;
      setInviteLink(link);
      setEmail("");
      setMessage(t("Invitation created."));
      await refresh();
    } catch (error) {
      setMessage(formatError(error, t("Invitation failed.")));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCopyInviteLink() {
    if (!inviteLink) {
      return;
    }
    await navigator.clipboard.writeText(inviteLink);
    setMessage(t("Invite link copied."));
  }

  async function handleUpdateMember(member: WorkspaceMember, nextRole: WorkspaceMemberRole) {
    setIsSaving(true);
    try {
      await updateWorkspaceMember(member.id, {
        role: nextRole as Exclude<WorkspaceMemberRole, "owner">
      });
      await refresh();
    } catch (error) {
      setMessage(formatError(error, t("Role update failed.")));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUpdateCollaborator(collaborator: Collaborator, nextRole: CollaboratorRole) {
    setIsSaving(true);
    try {
      await updateCollaborator(collaborator.id, {
        role: nextRole as Exclude<CollaboratorRole, "owner">
      });
      await refresh();
    } catch (error) {
      setMessage(formatError(error, t("Role update failed.")));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRemoveMember(member: WorkspaceMember) {
    const shouldRemove = await dialog.requestConfirmation({
      title: t("Remove member"),
      description: t("Remove this member?"),
      confirmLabel: t("Remove"),
      tone: "danger"
    });
    if (!shouldRemove) {
      return;
    }
    setIsSaving(true);
    try {
      await deleteWorkspaceMember(member.id);
      await refresh();
    } catch (error) {
      setMessage(formatError(error, t("Remove failed.")));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRemoveCollaborator(collaborator: Collaborator) {
    const shouldRemove = await dialog.requestConfirmation({
      title: t("Remove collaborator"),
      description: t("Remove this collaborator?"),
      confirmLabel: t("Remove"),
      tone: "danger"
    });
    if (!shouldRemove) {
      return;
    }
    setIsSaving(true);
    try {
      await deleteCollaborator(collaborator.id);
      await refresh();
    } catch (error) {
      setMessage(formatError(error, t("Remove failed.")));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleApproveInvitation(invitation: Invitation) {
    setIsSaving(true);
    try {
      await approveInvitation(invitation.id);
      await refresh();
    } catch (error) {
      setMessage(formatError(error, t("Approval failed.")));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRevokeInvitation(invitation: Invitation) {
    setIsSaving(true);
    try {
      await revokeInvitation(invitation.id);
      await refresh();
    } catch (error) {
      setMessage(formatError(error, t("Revoke failed.")));
    } finally {
      setIsSaving(false);
    }
  }

  const pendingApproval = invitations.filter((item) => item.status === "awaiting_approval");
  const activeInvitations = invitations.filter((item) => item.status === "pending");

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-zinc-950/20">
      <section className="flex h-full w-full max-w-xl flex-col border-l border-zinc-200 bg-white shadow-xl">
        <header className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase text-emerald-700">{t("Access")}</p>
            <h2 className="mt-1 truncate text-lg font-semibold">{target?.title ?? t("Access")}</h2>
            <p className="mt-1 text-sm text-zinc-500">{target?.subtitle ?? ""}</p>
          </div>
          <button className="icon-button" onClick={onClose} title={t("Close")} type="button">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <TargetTabs
            targetType={target?.type ?? targetType}
            targets={targets}
            onChange={setTargetType}
          />

          <section className="rounded-md border border-zinc-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                {isWorkspace ? t("Members") : t("Collaborators")}
              </h3>
              <button
                className="icon-button h-8 w-8"
                disabled={isLoading}
                onClick={() => void refresh()}
                type="button"
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {isWorkspace
                ? members.map((member) => (
                    <AccessRow
                      key={member.id}
                      locked={member.role === "owner"}
                      name={member.user?.display_name || member.user?.email || member.user_id}
                      role={member.role}
                      roles={["admin", "member", "guest"]}
                      status={member.user?.status}
                      onDelete={() => void handleRemoveMember(member)}
                      onRoleChange={(nextRole) =>
                        void handleUpdateMember(member, nextRole as WorkspaceMemberRole)
                      }
                    />
                  ))
                : collaborators.map((collaborator) => (
                    <AccessRow
                      key={collaborator.id}
                      locked={collaborator.role === "owner"}
                      name={
                        collaborator.user?.display_name ||
                        collaborator.user?.email ||
                        collaborator.subject_id
                      }
                      role={collaborator.role}
                      roles={["manager", "editor", "viewer"]}
                      status={collaborator.user?.status ?? collaborator.subject_type}
                      onDelete={() => void handleRemoveCollaborator(collaborator)}
                      onRoleChange={(nextRole) =>
                        void handleUpdateCollaborator(collaborator, nextRole as CollaboratorRole)
                      }
                    />
                  ))}
              {members.length === 0 && collaborators.length === 0 ? (
                <p className="rounded-md bg-zinc-50 px-3 py-3 text-sm text-zinc-500">
                  {t("No access entries yet.")}
                </p>
              ) : null}
            </div>
          </section>

          <section className="rounded-md border border-zinc-200 bg-white p-4">
            <h3 className="text-sm font-semibold">{t("Invite by email")}</h3>
            <div className="mt-3 grid gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-zinc-600">{t("Email")}</span>
                <input
                  className="h-9 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-emerald-500"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                  type="email"
                  value={email}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-sm">
                  <span className="mb-1 block text-zinc-600">{t("Role")}</span>
                  <select
                    className="h-9 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm"
                    onChange={(event) => setRole(event.target.value as InvitationRole)}
                    value={role}
                  >
                    {roleOptions.map((option) => (
                      <option key={option} value={option}>
                        {t(option)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-zinc-600">{t("Max uses")}</span>
                  <input
                    className="h-9 w-full rounded-md border border-zinc-300 px-3 text-sm"
                    min={1}
                    onChange={(event) => setMaxUses(event.target.value)}
                    type="number"
                    value={maxUses}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-zinc-600">{t("Expires")}</span>
                  <input
                    className="h-9 w-full rounded-md border border-zinc-300 px-3 text-sm"
                    onChange={(event) => setExpiresAt(event.target.value)}
                    type="datetime-local"
                    value={expiresAt}
                  />
                </label>
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
                <input
                  checked={requiresApproval}
                  onChange={(event) => setRequiresApproval(event.target.checked)}
                  type="checkbox"
                />
                {t("Require approval")}
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white hover:bg-zinc-800"
                  disabled={isSaving}
                  onClick={() => void handleCreateInvitation()}
                  type="button"
                >
                  <MailPlus className="h-4 w-4" />
                  {t("Create invite")}
                </button>
                {inviteLink ? (
                  <button
                    className="inline-flex h-9 items-center rounded-md border border-zinc-200 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                    onClick={() => void handleCopyInviteLink()}
                    type="button"
                  >
                    {t("Copy invite link")}
                  </button>
                ) : null}
              </div>
            </div>
          </section>

          <InvitationList
            invitations={pendingApproval}
            title={t("Pending approval")}
            onApprove={handleApproveInvitation}
            onRevoke={handleRevokeInvitation}
          />
          <InvitationList
            invitations={activeInvitations}
            title={t("Active invitations")}
            onRevoke={handleRevokeInvitation}
          />

          {message ? (
            <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
              {message}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function TargetTabs({
  onChange,
  targetType,
  targets
}: {
  onChange: (type: AccessObjectType) => void;
  targetType: AccessObjectType;
  targets: AccessTarget[];
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap gap-2">
      {targets.map((target) => (
        <button
          className={`inline-flex h-9 items-center rounded-md px-3 text-sm font-medium ${
            target.type === targetType
              ? "bg-zinc-950 text-white"
              : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
          }`}
          key={target.type}
          onClick={() => onChange(target.type)}
          type="button"
        >
          {t(accessTargetLabel(target.type))}
        </button>
      ))}
    </div>
  );
}

function AccessRow({
  locked,
  name,
  onDelete,
  onRoleChange,
  role,
  roles,
  status
}: {
  locked: boolean;
  name: string;
  onDelete: () => void;
  onRoleChange: (role: string) => void;
  role: string;
  roles: readonly string[];
  status?: string | null;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 rounded-md border border-zinc-200 px-3 py-2">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
        <UserRound className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-zinc-800">{name}</p>
        <p className="truncate text-xs text-zinc-500">{status ? t(status) : ""}</p>
      </div>
      {locked ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-600">
          <ShieldCheck className="h-3 w-3" />
          {t(role)}
        </span>
      ) : (
        <select
          className="h-8 rounded-md border border-zinc-300 bg-white px-2 text-sm"
          onChange={(event) => onRoleChange(event.target.value)}
          value={role}
        >
          {roles.map((item) => (
            <option key={item} value={item}>
              {t(item)}
            </option>
          ))}
        </select>
      )}
      <button className="icon-button h-8 w-8" disabled={locked} onClick={onDelete} type="button">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function InvitationList({
  invitations,
  onApprove,
  onRevoke,
  title
}: {
  invitations: Invitation[];
  onApprove?: (invitation: Invitation) => void | Promise<void>;
  onRevoke: (invitation: Invitation) => void | Promise<void>;
  title: string;
}) {
  const { t } = useI18n();
  return (
    <section className="rounded-md border border-zinc-200 bg-white p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-3 space-y-2">
        {invitations.length === 0 ? (
          <p className="rounded-md bg-zinc-50 px-3 py-3 text-sm text-zinc-500">
            {t("No invitations.")}
          </p>
        ) : (
          invitations.map((invitation) => (
            <div
              className="flex items-center gap-3 rounded-md border border-zinc-200 px-3 py-2"
              key={invitation.id}
            >
              <Clock3 className="h-4 w-4 shrink-0 text-amber-600" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {invitation.email ?? invitation.invited_user_id ?? t("Invite link")}
                </p>
                <p className="text-xs text-zinc-500">
                  {t(invitation.role)} · {t(invitation.status)}
                </p>
              </div>
              {onApprove ? (
                <button
                  className="icon-button h-8 w-8"
                  onClick={() => void onApprove(invitation)}
                  type="button"
                >
                  <Check className="h-4 w-4" />
                </button>
              ) : null}
              <button
                className="icon-button h-8 w-8"
                onClick={() => void onRevoke(invitation)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function accessTargetLabel(type: AccessObjectType): string {
  if (type === "workspace") return "Workspace";
  if (type === "knowledge_base") return "Knowledge base";
  return "Document";
}

function formatError(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) {
    return error.body.message || error.body.error || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}
