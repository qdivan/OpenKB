"use client";

import { RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import { useI18n } from "@/lib/i18n-provider";
import {
  getAdminOpsHealth,
  listAdminSecuritySecrets,
  rotateAdminSecuritySecret,
  type AdminOpsHealth,
  type AdminSecuritySecrets
} from "@/lib/openkb-api";

export default function SecurityAdminClient() {
  const { t } = useI18n();
  const [health, setHealth] = useState<AdminOpsHealth | null>(null);
  const [secrets, setSecrets] = useState<AdminSecuritySecrets | null>(null);
  const [message, setMessage] = useState("");

  async function load() {
    try {
      const [nextHealth, nextSecrets] = await Promise.all([
        getAdminOpsHealth(),
        listAdminSecuritySecrets()
      ]);
      setHealth(nextHealth);
      setSecrets(nextSecrets);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("Failed to load."));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <main className="min-h-screen bg-zinc-50">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {t("Admin")}
            </p>
            <h1 className="mt-1 text-2xl font-semibold">{t("Security Ops")}</h1>
            <p className="text-sm text-zinc-600">
              {t("Production health, metrics, and secret rotation.")}
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
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {message}
          </p>
        ) : null}

        <section className="grid gap-3 md:grid-cols-3">
          {health ? (
            <>
              <StatusCard label="Database" value={health.database} />
              <StatusCard label="SMTP" value={health.smtp.ok ? "ok" : health.smtp.source} />
              <StatusCard label="MCP OAuth" value={health.mcp_oauth.issuer ?? "not configured"} />
              <StatusCard label="Redis" value={health.redis} />
              <StatusCard label="S3" value={health.s3} />
              <StatusCard label="Milvus" value={health.milvus} />
            </>
          ) : (
            <p className="text-sm text-zinc-500">{t("Loading")}</p>
          )}
        </section>

        <section className="rounded-md border border-zinc-200 bg-white p-4">
          <h2 className="text-sm font-semibold">{t("Secret inventory")}</h2>
          <p className="mt-1 text-xs text-zinc-500">
            {t(
              "Raw secrets are never shown here. Use dedicated pages to rotate stored credentials."
            )}
          </p>
          <div className="mt-3 space-y-2">
            {secrets?.items.map((item) => (
              <div
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2"
                key={item.kind}
              >
                <div>
                  <p className="text-sm font-medium">{String(item.kind)}</p>
                  <p className="text-xs text-zinc-500">{JSON.stringify(item)}</p>
                </div>
                {item.kind === "mcp_oauth_refresh_tokens" ? (
                  <button
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-red-200 px-2 text-xs text-red-700"
                    onClick={async () => {
                      const result = await rotateAdminSecuritySecret("mcp_oauth_refresh_tokens");
                      setMessage(
                        t("Revoked {count} tokens.", { count: String(result.revoked_count ?? 0) })
                      );
                      await load();
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t("Revoke refresh tokens")}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function StatusCard({ label, value }: { label: string; value: string }) {
  const { t } = useI18n();
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4">
      <p className="text-xs text-zinc-500">{t(label)}</p>
      <p className="mt-2 text-lg font-semibold">{value}</p>
    </div>
  );
}
