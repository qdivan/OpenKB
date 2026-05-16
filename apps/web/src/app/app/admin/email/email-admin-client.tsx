"use client";

import { RefreshCw, Send, RotateCw, Save } from "lucide-react";
import { useEffect, useState } from "react";

import { useI18n } from "@/lib/i18n-provider";
import {
  getAdminEmailSettings,
  listAdminEmailOutbox,
  probeAdminEmailSettings,
  retryAdminEmailOutbox,
  sendAdminTestEmail,
  updateAdminEmailSettings,
  type AdminEmailOutboxItem,
  type AdminSmtpSettings
} from "@/lib/openkb-api";

export default function EmailAdminClient() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<AdminSmtpSettings | null>(null);
  const [outbox, setOutbox] = useState<AdminEmailOutboxItem[]>([]);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [nextSettings, nextOutbox] = await Promise.all([
        getAdminEmailSettings(),
        listAdminEmailOutbox({ limit: 20 })
      ]);
      setSettings(nextSettings);
      setOutbox(nextOutbox.items);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("Failed to load."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    if (!settings) return;
    const saved = await updateAdminEmailSettings({
      enabled: settings.enabled,
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      username: settings.username,
      from_email: settings.from_email,
      reply_to: settings.reply_to,
      ...(password ? { password } : {})
    });
    setPassword("");
    setSettings(saved);
    setMessage(t("Saved."));
  }

  async function probe() {
    if (!settings) return;
    const result = await probeAdminEmailSettings({
      enabled: settings.enabled,
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      username: settings.username,
      from_email: settings.from_email,
      reply_to: settings.reply_to,
      ...(password ? { password } : {})
    });
    setMessage(result.ok ? t("Check succeeded.") : result.message);
  }

  async function testSend() {
    const result = await sendAdminTestEmail({});
    setMessage(result.ok ? t("Test email sent.") : result.error || t("Test email failed."));
  }

  return (
    <main className="min-h-screen bg-zinc-50">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {t("Admin")}
            </p>
            <h1 className="mt-1 text-2xl font-semibold">{t("Email delivery")}</h1>
            <p className="text-sm text-zinc-600">
              {t("Configure production SMTP and inspect email outbox.")}
            </p>
          </div>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm"
            onClick={load}
          >
            <RefreshCw className="h-4 w-4" />
            {t("Refresh")}
          </button>
        </div>

        {message ? (
          <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
            {message}
          </p>
        ) : null}

        <section className="rounded-md border border-zinc-200 bg-white p-4">
          <h2 className="text-sm font-semibold">{t("SMTP settings")}</h2>
          {loading || !settings ? (
            <p className="mt-3 text-sm text-zinc-500">{t("Loading")}</p>
          ) : (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="flex items-center gap-2 text-sm md:col-span-2">
                <input
                  checked={settings.enabled}
                  onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })}
                  type="checkbox"
                />
                {t("Enable SMTP")}
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                  {settings.source.toUpperCase()}
                </span>
              </label>
              <Field
                label={t("Host")}
                value={settings.host ?? ""}
                onChange={(value) => setSettings({ ...settings, host: value })}
              />
              <Field
                label={t("Port")}
                type="number"
                value={settings.port ? String(settings.port) : ""}
                onChange={(value) =>
                  setSettings({ ...settings, port: value ? Number(value) : null })
                }
              />
              <Field
                label={t("Username")}
                value={settings.username ?? ""}
                onChange={(value) => setSettings({ ...settings, username: value })}
              />
              <Field
                label={t("Password")}
                type="password"
                value={password}
                placeholder={
                  settings.has_password
                    ? `${t("Secret set")} ${settings.password_last4 ?? ""}`
                    : t("Paste a new key")
                }
                onChange={setPassword}
              />
              <Field
                label={t("From email")}
                value={settings.from_email ?? ""}
                onChange={(value) => setSettings({ ...settings, from_email: value })}
              />
              <Field
                label={t("Reply to")}
                value={settings.reply_to ?? ""}
                onChange={(value) => setSettings({ ...settings, reply_to: value })}
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  checked={settings.secure}
                  onChange={(event) => setSettings({ ...settings, secure: event.target.checked })}
                  type="checkbox"
                />
                {t("Use TLS")}
              </label>
              <div className="flex flex-wrap gap-2 md:col-span-2">
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-3 text-sm text-white"
                  onClick={save}
                >
                  <Save className="h-4 w-4" />
                  {t("Save")}
                </button>
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm"
                  onClick={probe}
                >
                  <RefreshCw className="h-4 w-4" />
                  {t("Check")}
                </button>
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm"
                  onClick={testSend}
                >
                  <Send className="h-4 w-4" />
                  {t("Send test")}
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-md border border-zinc-200 bg-white p-4">
          <h2 className="text-sm font-semibold">{t("Email outbox")}</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b text-xs text-zinc-500">
                <tr>
                  <th className="px-2 py-2">{t("Recipient")}</th>
                  <th className="px-2 py-2">{t("Template")}</th>
                  <th className="px-2 py-2">{t("Subject")}</th>
                  <th className="px-2 py-2">{t("Status")}</th>
                  <th className="px-2 py-2">{t("Attempts")}</th>
                  <th className="px-2 py-2">{t("Action")}</th>
                </tr>
              </thead>
              <tbody>
                {outbox.map((item) => (
                  <tr className="border-b border-zinc-100" key={item.id}>
                    <td className="px-2 py-2">{item.to_email}</td>
                    <td className="px-2 py-2">{t(item.template)}</td>
                    <td className="px-2 py-2">{item.subject}</td>
                    <td className="px-2 py-2">{formatOutboxStatus(item.status, t)}</td>
                    <td className="px-2 py-2">{item.attempts}</td>
                    <td className="px-2 py-2">
                      <button
                        className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs"
                        onClick={async () => {
                          const result = await retryAdminEmailOutbox(item.id);
                          setMessage(
                            result.ok ? t("Retry succeeded.") : result.error || t("Retry failed.")
                          );
                          await load();
                        }}
                      >
                        <RotateCw className="h-3.5 w-3.5" />
                        {t("Retry")}
                      </button>
                    </td>
                  </tr>
                ))}
                {outbox.length === 0 ? (
                  <tr>
                    <td className="px-2 py-8 text-center text-zinc-500" colSpan={6}>
                      {t("No email outbox records.")}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-zinc-700">{label}</span>
      <input
        className="h-9 w-full rounded-md border border-zinc-300 px-3"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
    </label>
  );
}

function formatOutboxStatus(
  status: AdminEmailOutboxItem["status"],
  t: (key: string, values?: Record<string, string | number | boolean | null | undefined>) => string
) {
  const keyByStatus: Record<AdminEmailOutboxItem["status"], string> = {
    pending: "email_outbox_pending",
    sent: "email_outbox_sent",
    failed: "email_outbox_failed"
  };
  return t(keyByStatus[status] ?? "Unknown");
}
