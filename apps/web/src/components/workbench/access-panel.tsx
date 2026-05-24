"use client";

import {
  Check,
  Clock3,
  Copy,
  Globe2,
  Link2,
  Lock,
  MailPlus,
  RefreshCw,
  RotateCcw,
  Share2,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  X
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { useDialog } from "@/components/dialog-provider";
import { useI18n } from "@/lib/i18n-provider";
import {
  ApiRequestError,
  approveInvitation,
  createInvitation,
  createShareLink,
  deleteCollaborator,
  deleteWorkspaceMember,
  listCollaborators,
  listInvitations,
  listShareLinks,
  listWorkspaceMembers,
  resetShareLink,
  revokeInvitation,
  revokeShareLink,
  updateCollaborator,
  updateDocument,
  updateKnowledgeBase,
  updateWorkspaceMember,
  type AccessObjectType,
  type Collaborator,
  type CollaboratorRole,
  type DocumentDetail,
  type Invitation,
  type InvitationRole,
  type KnowledgeBase,
  type ShareLink,
  type WorkspaceMember,
  type WorkspaceMemberRole
} from "@/lib/openkb-api";

export type AccessTarget = {
  type: AccessObjectType;
  id: string;
  title: string;
  subtitle: string;
};

type Visibility = KnowledgeBase["visibility"];

export function AccessPanel({
  document,
  initialTargetType,
  knowledgeBase,
  onClose,
  onDocumentUpdated,
  onKnowledgeBaseUpdated,
  targets
}: {
  document?: DocumentDetail | null;
  initialTargetType: AccessObjectType;
  knowledgeBase?: KnowledgeBase | null;
  onClose: () => void;
  onDocumentUpdated?: (document: DocumentDetail) => void;
  onKnowledgeBaseUpdated?: (knowledgeBase: KnowledgeBase) => void;
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
  const [kbVisibility, setKbVisibility] = useState<Visibility>(
    knowledgeBase?.visibility ?? "private"
  );
  const [documentPermissionMode, setDocumentPermissionMode] = useState<"inherit" | "custom">(
    document?.permission_mode === "custom" ? "custom" : "inherit"
  );
  const [documentVisibility, setDocumentVisibility] = useState<Visibility>(
    (document?.visibility as Visibility | null) ?? knowledgeBase?.visibility ?? "private"
  );
  const [shareLinks, setShareLinks] = useState<ShareLink[]>([]);
  const [sharePassword, setSharePassword] = useState("");
  const [shareRequireLogin, setShareRequireLogin] = useState(false);
  const [shareMemberOnly, setShareMemberOnly] = useState(false);
  const [shareExpiresAt, setShareExpiresAt] = useState("");
  const [shareLastUrl, setShareLastUrl] = useState("");
  const [shareLoading, setShareLoading] = useState(false);

  const target = useMemo(
    () => targets.find((item) => item.type === targetType) ?? targets[0] ?? null,
    [targetType, targets]
  );
  const isWorkspace = target?.type === "workspace";
  const isKnowledgeBase = target?.type === "knowledge_base";
  const isDocument = target?.type === "document";
  const roleOptions = isWorkspace
    ? (["admin", "member", "guest"] as const)
    : (["manager", "editor", "viewer"] as const);
  const activeShareLink = shareLinks.find((link) => !link.revoked_at) ?? null;
  const revokedShareLinks = shareLinks.filter((link) => link.revoked_at);

  useEffect(() => {
    setTargetType(initialTargetType);
  }, [initialTargetType]);

  useEffect(() => {
    setRole((target?.type === "workspace" ? "member" : "viewer") as InvitationRole);
  }, [target?.type]);

  useEffect(() => {
    setKbVisibility(knowledgeBase?.visibility ?? "private");
  }, [knowledgeBase?.id, knowledgeBase?.visibility]);

  useEffect(() => {
    setDocumentPermissionMode(document?.permission_mode === "custom" ? "custom" : "inherit");
    setDocumentVisibility(
      (document?.visibility as Visibility | null) ?? knowledgeBase?.visibility ?? "private"
    );
  }, [document?.id, document?.permission_mode, document?.visibility, knowledgeBase?.visibility]);

  useEffect(() => {
    if (!target) {
      return;
    }
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id, target?.type]);

  useEffect(() => {
    if (!isDocument || !target) {
      setShareLinks([]);
      return;
    }
    void refreshShareLinks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDocument, target?.id]);

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

  async function refreshShareLinks() {
    if (!target || target.type !== "document") {
      return;
    }
    setShareLoading(true);
    try {
      setShareLinks(await listShareLinks(target.type, target.id));
      setShareLastUrl("");
    } catch (error) {
      setMessage(formatError(error, t("Failed to load share links.")));
    } finally {
      setShareLoading(false);
    }
  }

  async function handleSaveKnowledgeBaseVisibility() {
    if (!knowledgeBase) {
      return;
    }
    setIsSaving(true);
    setMessage("");
    try {
      const updated = await updateKnowledgeBase(knowledgeBase.id, { visibility: kbVisibility });
      onKnowledgeBaseUpdated?.(updated);
      setMessage(t("Knowledge base visibility saved."));
    } catch (error) {
      setMessage(formatError(error, t("Visibility update failed.")));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveDocumentPermission() {
    if (!document) {
      return;
    }
    setIsSaving(true);
    setMessage("");
    try {
      const updated = await updateDocument(document.id, {
        permission_mode: documentPermissionMode,
        visibility: documentPermissionMode === "custom" ? documentVisibility : null
      });
      onDocumentUpdated?.(updated);
      setMessage(t("Document permission saved."));
    } catch (error) {
      setMessage(formatError(error, t("Permission update failed.")));
    } finally {
      setIsSaving(false);
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

  async function handleCreateShareLink() {
    if (!target || target.type !== "document") {
      return;
    }
    setIsSaving(true);
    setMessage("");
    try {
      const link = await createShareLink(target.type, target.id, {
        password: sharePassword.trim() || null,
        require_login: shareRequireLogin,
        restrict_to_workspace_members: shareMemberOnly,
        expires_at: shareExpiresAt ? new Date(shareExpiresAt).toISOString() : null
      });
      setSharePassword("");
      setShareLastUrl(link.url ?? "");
      setMessage(t("Share link created."));
      await refreshShareLinks();
      setShareLastUrl(link.url ?? "");
    } catch (error) {
      setMessage(formatError(error, t("Share link failed.")));
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

  async function handleCopyShareLink(url = shareLastUrl) {
    if (!url) {
      return;
    }
    await navigator.clipboard.writeText(url);
    setMessage(t("Share link copied."));
  }

  async function handleCloseShareLink() {
    if (!activeShareLink) {
      return;
    }
    setIsSaving(true);
    setMessage("");
    try {
      await revokeShareLink(activeShareLink.id);
      await refreshShareLinks();
      setMessage(t("Share link closed."));
    } catch (error) {
      setMessage(formatError(error, t("Close share failed.")));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleResetShareLink() {
    if (!activeShareLink) {
      return;
    }
    setIsSaving(true);
    setMessage("");
    try {
      const link = await resetShareLink(activeShareLink.id);
      await refreshShareLinks();
      setShareLastUrl(link.url ?? "");
      setMessage(t("Share link reset."));
    } catch (error) {
      setMessage(formatError(error, t("Reset share failed.")));
    } finally {
      setIsSaving(false);
    }
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
      <section className="flex h-full w-full max-w-2xl flex-col border-l border-zinc-200 bg-white shadow-xl">
        <header className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase text-emerald-700">
              {t(permissionPanelEyebrow(target?.type))}
            </p>
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

          <RoleReference targetType={target?.type ?? targetType} />

          {isKnowledgeBase && knowledgeBase ? (
            <VisibilitySection
              description={t(
                "Visibility decides who can read the knowledge base before collaborator roles are considered."
              )}
              disabled={isSaving}
              onSave={() => void handleSaveKnowledgeBaseVisibility()}
              onVisibilityChange={setKbVisibility}
              title={t("Knowledge base visibility")}
              value={kbVisibility}
            />
          ) : null}

          {isDocument && document ? (
            <section className="rounded-md border border-zinc-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">{t("Document permission")}</h3>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">
                    {t(
                      "Documents inherit knowledge base visibility by default. Use custom permission only when this document needs an exception."
                    )}
                  </p>
                </div>
                <button
                  className="inline-flex h-8 items-center rounded-md bg-zinc-950 px-3 text-xs font-medium text-white disabled:bg-zinc-300"
                  disabled={isSaving}
                  onClick={() => void handleSaveDocumentPermission()}
                  type="button"
                >
                  {t("Save permission")}
                </button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1 block text-zinc-600">{t("Permission mode")}</span>
                  <select
                    className="h-9 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm"
                    onChange={(event) =>
                      setDocumentPermissionMode(event.target.value as "inherit" | "custom")
                    }
                    value={documentPermissionMode}
                  >
                    <option value="inherit">{t("Inherit knowledge base permission")}</option>
                    <option value="custom">{t("Custom document permission")}</option>
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-zinc-600">{t("Document visibility")}</span>
                  <select
                    className="h-9 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm disabled:bg-zinc-50 disabled:text-zinc-400"
                    disabled={documentPermissionMode !== "custom"}
                    onChange={(event) => setDocumentVisibility(event.target.value as Visibility)}
                    value={documentVisibility}
                  >
                    {visibilityOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t(option.label)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>
          ) : null}

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
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              {isWorkspace
                ? t("Workspace invitations grant admin, member, or guest roles.")
                : t(
                    "Content invitations grant manager, editor, or viewer roles. Owner is not granted by ordinary invitation."
                  )}
            </p>
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

          {isDocument ? (
            <section className="rounded-md border border-zinc-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">{t("Share link")}</h3>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">
                    {t("Share links are view-only in this version.")}
                  </p>
                </div>
                <button
                  className="icon-button h-8 w-8"
                  disabled={shareLoading}
                  onClick={() => void refreshShareLinks()}
                  type="button"
                >
                  <RefreshCw className={`h-4 w-4 ${shareLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
              {activeShareLink ? (
                <div className="mt-3 space-y-3 rounded-md bg-zinc-50 p-3">
                  <div className="flex flex-wrap gap-2 text-xs">
                    <SmallBadge icon={<Share2 className="h-3 w-3" />}>{t("View only")}</SmallBadge>
                    {activeShareLink.has_password ? (
                      <SmallBadge icon={<Lock className="h-3 w-3" />}>
                        {t("Password protected")}
                      </SmallBadge>
                    ) : null}
                    {activeShareLink.require_login ? (
                      <SmallBadge icon={<ShieldCheck className="h-3 w-3" />}>
                        {t("Login required")}
                      </SmallBadge>
                    ) : null}
                    {activeShareLink.restrict_to_workspace_members ? (
                      <SmallBadge icon={<Users className="h-3 w-3" />}>
                        {t("Workspace members only")}
                      </SmallBadge>
                    ) : null}
                  </div>
                  <p className="text-xs text-zinc-500">
                    {activeShareLink.expires_at
                      ? t("Expires at {time}", {
                          time: new Date(activeShareLink.expires_at).toLocaleString()
                        })
                      : t("No expiration")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {shareLastUrl ? (
                      <button
                        className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                        onClick={() => void handleCopyShareLink()}
                        type="button"
                      >
                        <Copy className="h-4 w-4" />
                        {t("Copy link")}
                      </button>
                    ) : null}
                    <button
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                      disabled={isSaving}
                      onClick={() => void handleResetShareLink()}
                      type="button"
                    >
                      <RotateCcw className="h-4 w-4" />
                      {t("Reset link")}
                    </button>
                    <button
                      className="inline-flex h-9 items-center rounded-md border border-red-200 px-3 text-sm font-medium text-red-700 hover:bg-red-50"
                      disabled={isSaving}
                      onClick={() => void handleCloseShareLink()}
                      type="button"
                    >
                      {t("Close share")}
                    </button>
                  </div>
                  {!shareLastUrl ? (
                    <p className="text-xs text-zinc-500">
                      {t("Reset the link to reveal a copyable URL.")}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 rounded-md bg-zinc-50 px-3 py-3 text-sm text-zinc-500">
                  {t("No active share link.")}
                </p>
              )}

              <div className="mt-4 grid gap-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block text-sm">
                    <span className="mb-1 block text-zinc-600">{t("Password optional")}</span>
                    <input
                      className="h-9 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-emerald-500"
                      onChange={(event) => setSharePassword(event.target.value)}
                      placeholder={t("Leave blank for no password")}
                      type="password"
                      value={sharePassword}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-zinc-600">{t("Expires")}</span>
                    <input
                      className="h-9 w-full rounded-md border border-zinc-300 px-3 text-sm"
                      onChange={(event) => setShareExpiresAt(event.target.value)}
                      type="datetime-local"
                      value={shareExpiresAt}
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-4">
                  <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
                    <input
                      checked={shareRequireLogin}
                      onChange={(event) => setShareRequireLogin(event.target.checked)}
                      type="checkbox"
                    />
                    {t("Require login")}
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
                    <input
                      checked={shareMemberOnly}
                      onChange={(event) => setShareMemberOnly(event.target.checked)}
                      type="checkbox"
                    />
                    {t("Workspace members only")}
                  </label>
                </div>
                <button
                  className="inline-flex h-9 w-fit items-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white hover:bg-zinc-800"
                  disabled={isSaving}
                  onClick={() => void handleCreateShareLink()}
                  type="button"
                >
                  <Link2 className="h-4 w-4" />
                  {t("Create share")}
                </button>
                {revokedShareLinks.length > 0 ? (
                  <p className="text-xs text-zinc-500">
                    {t("Share history")}: {revokedShareLinks.length}
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}

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

const visibilityOptions: Array<{ value: Visibility; label: string; icon: ReactNode }> = [
  { value: "private", label: "Only collaborators", icon: <Lock className="h-4 w-4" /> },
  { value: "workspace", label: "Space members", icon: <Users className="h-4 w-4" /> },
  { value: "public", label: "Public", icon: <Globe2 className="h-4 w-4" /> }
];

function VisibilitySection({
  description,
  disabled,
  onSave,
  onVisibilityChange,
  title,
  value
}: {
  description: string;
  disabled: boolean;
  onSave: () => void;
  onVisibilityChange: (value: Visibility) => void;
  title: string;
  value: Visibility;
}) {
  const { t } = useI18n();
  return (
    <section className="rounded-md border border-zinc-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p>
        </div>
        <button
          className="inline-flex h-8 items-center rounded-md bg-zinc-950 px-3 text-xs font-medium text-white disabled:bg-zinc-300"
          disabled={disabled}
          onClick={onSave}
          type="button"
        >
          {t("Save visibility")}
        </button>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-3">
        {visibilityOptions.map((option) => (
          <button
            className={`rounded-md border px-3 py-3 text-left ${
              value === option.value
                ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
            }`}
            key={option.value}
            onClick={() => onVisibilityChange(option.value)}
            type="button"
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              {option.icon}
              {t(option.label)}
            </span>
            <span className="mt-1 block text-xs leading-5 text-zinc-500">
              {t(visibilityHelp(option.value))}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function RoleReference({ targetType }: { targetType: AccessObjectType }) {
  const { t } = useI18n();
  const rows: Array<[string, string]> =
    targetType === "workspace"
      ? [
          ["owner", "Space owner can manage the space, members, and all space settings."],
          ["admin", "Space admin can manage members and shared space settings."],
          ["member", "Space member can access workspace-visible knowledge bases."],
          ["guest", "Space guest has limited space visibility and needs content permission."]
        ]
      : [
          ["owner", "Content owner keeps full management authority."],
          ["manager", "Manager can manage content settings and collaborators."],
          ["editor", "Editor can read and edit content."],
          ["viewer", "Viewer can read content only."]
        ];
  return (
    <section className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-emerald-700" />
        <h3 className="text-sm font-semibold">
          {targetType === "workspace" ? t("Space member roles") : t("Content collaborator roles")}
        </h3>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {rows.map(([role, description]) => (
          <div key={role} className="rounded-md bg-white px-3 py-2 ring-1 ring-zinc-200">
            <p className="text-xs font-semibold text-zinc-800">{t(role)}</p>
            <p className="mt-1 text-xs leading-5 text-zinc-500">{t(description)}</p>
          </div>
        ))}
      </div>
    </section>
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

function SmallBadge({ children, icon }: { children: ReactNode; icon: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-zinc-600 ring-1 ring-zinc-200">
      {icon}
      {children}
    </span>
  );
}

function accessTargetLabel(type: AccessObjectType): string {
  if (type === "workspace") return "Space members";
  if (type === "knowledge_base") return "Knowledge base permission";
  return "Document permission";
}

function permissionPanelEyebrow(type?: AccessObjectType): string {
  if (type === "workspace") return "Space permissions";
  if (type === "knowledge_base") return "Knowledge base permissions";
  if (type === "document") return "Document permissions";
  return "Access";
}

function visibilityHelp(value: Visibility): string {
  if (value === "public") return "Anyone with access to the instance can read public content.";
  if (value === "workspace") return "Space members can read workspace-visible content.";
  return "Only explicit collaborators can read private content.";
}

function formatError(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) {
    return error.body.message || error.body.error || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}
