"use client";

import { LoaderCircle, RefreshCw, Save, ShieldCheck } from "lucide-react";
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
      const saved = await updateAdminAuthSettings({
        scope,
        registration_enabled: settings.registration_enabled,
        email_verification_required: settings.email_verification_required,
        default_signup_status: settings.default_signup_status,
        invited_user_auto_active: settings.invited_user_auto_active,
        allowed_email_domains: domains
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        invite_required: settings.invite_required,
        first_user_becomes_admin: settings.first_user_becomes_admin
      });
      setSettings(saved);
      setDomains(saved.allowed_email_domains.join(", "));
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

            <label className="block text-sm">
              <span className="mb-1 block font-medium text-zinc-700">
                {t("Allowed email domains")}
              </span>
              <input
                className={inputClass}
                onChange={(event) => setDomains(event.target.value)}
                placeholder="example.com, openkb.local"
                value={domains}
              />
            </label>

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
