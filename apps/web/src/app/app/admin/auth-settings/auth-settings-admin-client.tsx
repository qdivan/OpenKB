"use client";

import { Edit3, LoaderCircle, RefreshCw, Save, ShieldCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import {
  ApiRequestError,
  getAdminAuthSettings,
  isUnauthorized,
  updateAdminAuthSettings,
  type AdminAuthSettings
} from "@/lib/openkb-api";
import { useI18n } from "@/lib/i18n-provider";

const inputClass =
  "h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

export function AuthSettingsAdminClient() {
  const router = useRouter();
  const { t } = useI18n();
  const [settings, setSettings] = useState<AdminAuthSettings | null>(null);
  const [domains, setDomains] = useState("");
  const [domainRestrictionEnabled, setDomainRestrictionEnabled] = useState(false);
  const [domainDialogOpen, setDomainDialogOpen] = useState(false);
  const [domainDraft, setDomainDraft] = useState("");
  const [domainError, setDomainError] = useState("");
  const [scope, setScope] = useState<"instance" | "tenant">("tenant");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void load();
  }, [scope]);

  async function load() {
    setIsLoading(true);
    setMessage("");
    try {
      const next = await getAdminAuthSettings({ scope });
      setSettings(next);
      setDomains(next.allowed_email_domains.join(", "));
      setDomainRestrictionEnabled(next.allowed_email_domains.length > 0);
      setDomainDialogOpen(false);
      setDomainDraft("");
      setDomainError("");
    } catch (error) {
      handleError(error);
    } finally {
      setIsLoading(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) {
      return;
    }
    setIsSaving(true);
    setMessage("");
    try {
      const allowedDomains = domainRestrictionEnabled ? parseAllowedEmailDomains(domains) : [];
      if (domainRestrictionEnabled && allowedDomains.length === 0) {
        setMessage(t("Add at least one allowed email domain before saving."));
        openDomainDialog();
        return;
      }
      const saved = await updateAdminAuthSettings({
        scope,
        registration_enabled: settings.registration_enabled,
        email_verification_required: settings.email_verification_required,
        default_signup_status: settings.default_signup_status,
        invited_user_auto_active: settings.invited_user_auto_active,
        allowed_email_domains: allowedDomains,
        invite_required: settings.invite_required,
        first_user_becomes_admin: settings.first_user_becomes_admin
      });
      setSettings(saved);
      setDomains(saved.allowed_email_domains.join(", "));
      setDomainRestrictionEnabled(saved.allowed_email_domains.length > 0);
      setMessage(t("Auth settings saved."));
    } catch (error) {
      handleError(error);
    } finally {
      setIsSaving(false);
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

  function patch(next: Partial<AdminAuthSettings>) {
    setSettings((current) => (current ? { ...current, ...next } : current));
  }

  function openDomainDialog() {
    setDomainDraft(domains);
    setDomainError("");
    setDomainDialogOpen(true);
  }

  function closeDomainDialog() {
    setDomainDialogOpen(false);
    setDomainError("");
  }

  function saveDomainDialog() {
    try {
      const nextDomains = parseAllowedEmailDomains(domainDraft);
      if (nextDomains.length === 0) {
        setDomainError(t("Add at least one allowed email domain."));
        return;
      }
      setDomains(nextDomains.join(", "));
      setDomainRestrictionEnabled(true);
      setDomainDialogOpen(false);
      setDomainError("");
    } catch (error) {
      setDomainError(error instanceof Error ? error.message : t("Invalid email domain."));
    }
  }

  function toggleDomainRestriction(enabled: boolean) {
    setDomainRestrictionEnabled(enabled);
    if (enabled && parseAllowedEmailDomainsLenient(domains).length === 0) {
      openDomainDialog();
    }
  }

  const domainItems = parseAllowedEmailDomainsLenient(domains);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase text-zinc-500">{t("Admin")}</p>
          <h1 className="mt-1 text-2xl font-semibold">{t("Auth Settings")}</h1>
          <p className="mt-1 text-sm text-zinc-600">
            {t("Manage registration, activation, and email verification policy.")}
          </p>
        </div>
        <button
          className="icon-button"
          onClick={() => void load()}
          title={t("Refresh")}
          type="button"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </header>

      <section className="rounded-md border border-zinc-200 bg-white p-4">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-700" />
          <select
            className={inputClass}
            onChange={(event) => setScope(event.target.value as "instance" | "tenant")}
            value={scope}
          >
            <option value="tenant">{t("Tenant override")}</option>
            <option value="instance">{t("Instance default")}</option>
          </select>
        </div>

        {isLoading && !settings ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            {t("Loading")}
          </div>
        ) : null}

        {settings ? (
          <form className="space-y-4" onSubmit={(event) => void save(event)}>
            <div className="grid gap-3 md:grid-cols-2">
              <Toggle
                checked={settings.registration_enabled}
                label={t("Registration enabled")}
                onChange={(value) => patch({ registration_enabled: value })}
              />
              <Toggle
                checked={settings.email_verification_required}
                label={t("Email verification required")}
                onChange={(value) => patch({ email_verification_required: value })}
              />
              <Toggle
                checked={settings.invite_required}
                label={t("Invite required")}
                onChange={(value) => patch({ invite_required: value })}
              />
              <Toggle
                checked={settings.invited_user_auto_active}
                label={t("Invited users auto active")}
                onChange={(value) => patch({ invited_user_auto_active: value })}
              />
              <Toggle
                checked={settings.first_user_becomes_admin}
                label={t("First user becomes admin")}
                onChange={(value) => patch({ first_user_becomes_admin: value })}
              />
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-zinc-700">
                  {t("Default signup status")}
                </span>
                <select
                  className={inputClass}
                  onChange={(event) =>
                    patch({
                      default_signup_status: event.target.value as "active" | "pending_activation"
                    })
                  }
                  value={settings.default_signup_status}
                >
                  <option value="active">{t("Active")}</option>
                  <option value="pending_activation">{t("Pending activation")}</option>
                </select>
              </label>
            </div>

            <div className="rounded-md border border-zinc-200 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <label className="flex min-w-0 flex-1 items-start gap-3 text-sm">
                  <input
                    checked={domainRestrictionEnabled}
                    className="mt-1 h-4 w-4 accent-emerald-600"
                    onChange={(event) => toggleDomainRestriction(event.target.checked)}
                    type="checkbox"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium text-zinc-800">
                      {t("Restrict registration to allowed email domains")}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-zinc-500">
                      {t(
                        "Only users whose email domain is in the whitelist can self-register. Admin-created users are not affected."
                      )}
                    </span>
                  </span>
                </label>
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
                  disabled={!domainRestrictionEnabled}
                  onClick={openDomainDialog}
                  type="button"
                >
                  <Edit3 className="h-4 w-4" />
                  {t("Edit whitelist")}
                </button>
              </div>

              <div className="mt-3 rounded-md bg-zinc-50 px-3 py-2">
                {domainRestrictionEnabled && domainItems.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {domainItems.map((domain) => (
                      <span
                        className="rounded-full bg-white px-2 py-1 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200"
                        key={domain}
                      >
                        @{domain}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">
                    {domainRestrictionEnabled
                      ? t("No allowed email domains configured yet.")
                      : t(
                          "Domain restriction is off. Any valid email can register if registration is enabled."
                        )}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white disabled:bg-zinc-400"
                disabled={isSaving}
                type="submit"
              >
                {isSaving ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {t("Save")}
              </button>
              {message ? <p className="text-sm text-zinc-600">{message}</p> : null}
            </div>
          </form>
        ) : null}
      </section>

      {domainDialogOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-zinc-950/30 px-4 py-6">
          <div
            aria-modal="true"
            className="w-full max-w-lg rounded-md bg-white shadow-xl"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-zinc-900">
                  {t("Edit allowed email domains")}
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  {t("Add one domain per line or separate them with commas.")}
                </p>
              </div>
              <button className="icon-button" onClick={closeDomainDialog} type="button">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 px-4 py-4">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-zinc-700">
                  {t("Allowed email domains")}
                </span>
                <textarea
                  className="min-h-32 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  onChange={(event) => setDomainDraft(event.target.value)}
                  placeholder={"sailuntire.com\n@qq.com\nuser@example.org"}
                  value={domainDraft}
                />
              </label>
              <p className="text-xs leading-5 text-zinc-500">
                {t("You can enter domains like sailuntire.com, @qq.com, or user@example.org.")}
              </p>
              {domainError ? (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{domainError}</p>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-zinc-200 px-4 py-3">
              <button
                className="h-9 rounded-md border border-zinc-200 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                onClick={closeDomainDialog}
                type="button"
              >
                {t("Cancel")}
              </button>
              <button
                className="h-9 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white"
                onClick={saveDomainDialog}
                type="button"
              >
                {t("Save whitelist")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Toggle({
  checked,
  label,
  onChange
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 px-3 py-2 text-sm">
      <span className="font-medium text-zinc-700">{label}</span>
      <input
        checked={checked}
        className="h-4 w-4 accent-emerald-600"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
    </label>
  );
}

function parseAllowedEmailDomains(input: string): string[] {
  const domains = parseAllowedEmailDomainsLenient(input);
  const invalid = splitDomainInput(input).find((item) => {
    try {
      normalizeAllowedEmailDomain(item);
      return false;
    } catch {
      return true;
    }
  });
  if (invalid) {
    throw new Error(`Invalid email domain: ${invalid}`);
  }
  return domains;
}

function parseAllowedEmailDomainsLenient(input: string): string[] {
  const domains = splitDomainInput(input)
    .map((item) => {
      try {
        return normalizeAllowedEmailDomain(item);
      } catch {
        return null;
      }
    })
    .filter((domain): domain is string => Boolean(domain));
  return Array.from(new Set(domains));
}

function splitDomainInput(input: string): string[] {
  return input
    .split(/[\s,;，；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeAllowedEmailDomain(value: string): string | null {
  let domain = value.trim().toLowerCase();
  if (!domain) {
    return null;
  }
  if (domain.includes("@")) {
    domain = domain.split("@").pop() ?? "";
  }
  domain = domain.replace(/^\*\./, "").replace(/^@/, "");
  if (
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
      domain
    )
  ) {
    throw new Error(`Invalid email domain: ${value}`);
  }
  return domain;
}
