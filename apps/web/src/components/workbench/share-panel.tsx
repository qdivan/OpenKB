"use client";

import { Copy, Lock, RefreshCw, RotateCcw, Share2, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { useI18n } from "@/lib/i18n-provider";
import {
  ApiRequestError,
  createShareLink,
  listShareLinks,
  resetShareLink,
  revokeShareLink,
  type AccessObjectType,
  type ShareLink
} from "@/lib/openkb-api";

import type { AccessTarget } from "./access-panel";

export function SharePanel({
  initialTargetType,
  onClose,
  targets
}: {
  initialTargetType: AccessObjectType;
  onClose: () => void;
  targets: AccessTarget[];
}) {
  const { t } = useI18n();
  const [targetType, setTargetType] = useState<AccessObjectType>(initialTargetType);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [password, setPassword] = useState("");
  const [requireLogin, setRequireLogin] = useState(false);
  const [memberOnly, setMemberOnly] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const [lastUrl, setLastUrl] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const target = useMemo(
    () => targets.find((item) => item.type === targetType) ?? targets[0] ?? null,
    [targetType, targets]
  );
  const activeLink = links.find((link) => !link.revoked_at) ?? null;
  const historyLinks = links.filter((link) => link.revoked_at);

  useEffect(() => {
    setTargetType(initialTargetType);
  }, [initialTargetType]);

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
      setLinks(await listShareLinks(target.type, target.id));
      setLastUrl("");
    } catch (error) {
      setMessage(formatError(error, t("Failed to load share links.")));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreate() {
    if (!target) {
      return;
    }
    setIsSaving(true);
    setMessage("");
    try {
      const link = await createShareLink(target.type, target.id, {
        password: password.trim() || null,
        require_login: requireLogin,
        restrict_to_workspace_members: memberOnly,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null
      });
      setPassword("");
      setLastUrl(link.url ?? "");
      setMessage(t("Share link created."));
      await refresh();
      setLastUrl(link.url ?? "");
    } catch (error) {
      setMessage(formatError(error, t("Share link failed.")));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCopy(url = lastUrl) {
    if (!url) {
      return;
    }
    await navigator.clipboard.writeText(url);
    setMessage(t("Share link copied."));
  }

  async function handleRevoke() {
    if (!activeLink) {
      return;
    }
    setIsSaving(true);
    try {
      await revokeShareLink(activeLink.id);
      setLastUrl("");
      await refresh();
      setMessage(t("Share link closed."));
    } catch (error) {
      setMessage(formatError(error, t("Close share failed.")));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleReset() {
    if (!activeLink) {
      return;
    }
    setIsSaving(true);
    try {
      const link = await resetShareLink(activeLink.id);
      setLastUrl(link.url ?? "");
      await refresh();
      setLastUrl(link.url ?? "");
      setMessage(t("Share link reset."));
    } catch (error) {
      setMessage(formatError(error, t("Reset share failed.")));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-zinc-950/20">
      <section className="flex h-full w-full max-w-lg flex-col border-l border-zinc-200 bg-white shadow-xl">
        <header className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase text-sky-700">{t("Share")}</p>
            <h2 className="mt-1 truncate text-lg font-semibold">{target?.title ?? t("Share")}</h2>
            <p className="mt-1 text-sm text-zinc-500">{target?.subtitle ?? ""}</p>
          </div>
          <button className="icon-button" onClick={onClose} title={t("Close")} type="button">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <div className="flex flex-wrap gap-2">
            {targets.map((item) => (
              <button
                className={`inline-flex h-9 items-center rounded-md px-3 text-sm font-medium ${
                  item.type === targetType
                    ? "bg-zinc-950 text-white"
                    : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                }`}
                key={item.type}
                onClick={() => setTargetType(item.type)}
                type="button"
              >
                {t(targetLabel(item.type))}
              </button>
            ))}
          </div>

          <section className="rounded-md border border-zinc-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t("Current share")}</h3>
              <button
                className="icon-button h-8 w-8"
                disabled={isLoading}
                onClick={() => void refresh()}
                type="button"
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              </button>
            </div>
            {activeLink ? (
              <div className="mt-3 space-y-3 rounded-md bg-zinc-50 p-3">
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge icon={<Share2 className="h-3 w-3" />}>{t("View only")}</Badge>
                  {activeLink.has_password ? (
                    <Badge icon={<Lock className="h-3 w-3" />}>{t("Password protected")}</Badge>
                  ) : null}
                  {activeLink.require_login ? (
                    <Badge icon={<ShieldCheck className="h-3 w-3" />}>{t("Login required")}</Badge>
                  ) : null}
                  {activeLink.restrict_to_workspace_members ? (
                    <Badge icon={<ShieldCheck className="h-3 w-3" />}>
                      {t("Workspace members only")}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-zinc-500">
                  {activeLink.expires_at
                    ? t("Expires at {time}", {
                        time: new Date(activeLink.expires_at).toLocaleString()
                      })
                    : t("No expiration")}
                </p>
                {lastUrl ? (
                  <button
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                    onClick={() => void handleCopy()}
                    type="button"
                  >
                    <Copy className="h-4 w-4" />
                    {t("Copy link")}
                  </button>
                ) : (
                  <p className="text-xs text-zinc-500">
                    {t("Reset the link to reveal a copyable URL.")}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-200 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                    disabled={isSaving}
                    onClick={() => void handleReset()}
                    type="button"
                  >
                    <RotateCcw className="h-4 w-4" />
                    {t("Reset link")}
                  </button>
                  <button
                    className="inline-flex h-9 items-center rounded-md border border-red-200 px-3 text-sm font-medium text-red-700 hover:bg-red-50"
                    disabled={isSaving}
                    onClick={() => void handleRevoke()}
                    type="button"
                  >
                    {t("Close share")}
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-3 rounded-md bg-zinc-50 px-3 py-3 text-sm text-zinc-500">
                {t("No active share link.")}
              </p>
            )}
          </section>

          <section className="rounded-md border border-zinc-200 bg-white p-4">
            <h3 className="text-sm font-semibold">{t("Create share link")}</h3>
            <div className="mt-3 grid gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-zinc-600">{t("Password optional")}</span>
                <input
                  className="h-9 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-emerald-500"
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={t("Leave blank for no password")}
                  type="password"
                  value={password}
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
              <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
                <input
                  checked={requireLogin}
                  onChange={(event) => setRequireLogin(event.target.checked)}
                  type="checkbox"
                />
                {t("Require login")}
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
                <input
                  checked={memberOnly}
                  onChange={(event) => setMemberOnly(event.target.checked)}
                  type="checkbox"
                />
                {t("Workspace members only")}
              </label>
              <button
                className="inline-flex h-9 w-fit items-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white hover:bg-zinc-800"
                disabled={isSaving}
                onClick={() => void handleCreate()}
                type="button"
              >
                <Share2 className="h-4 w-4" />
                {t("Create share")}
              </button>
            </div>
          </section>

          {historyLinks.length > 0 ? (
            <section className="rounded-md border border-zinc-200 bg-white p-4">
              <h3 className="text-sm font-semibold">{t("Share history")}</h3>
              <div className="mt-3 space-y-2">
                {historyLinks.slice(0, 5).map((link) => (
                  <div
                    className="flex items-center justify-between gap-3 rounded-md bg-zinc-50 px-3 py-2 text-sm"
                    key={link.id}
                  >
                    <span className="truncate text-zinc-600">{link.id}</span>
                    <span className="text-xs text-zinc-400">{t("revoked")}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

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

function Badge({ children, icon }: { children: ReactNode; icon: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-zinc-600 ring-1 ring-zinc-200">
      {icon}
      {children}
    </span>
  );
}

function targetLabel(type: AccessObjectType): string {
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
