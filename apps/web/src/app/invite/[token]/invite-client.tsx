"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { LanguageSwitcher } from "@/components/language-switcher";
import { useI18n } from "@/lib/i18n-provider";
import {
  ApiRequestError,
  acceptInvitation,
  getInvitation,
  isUnauthorized,
  type InvitationDetail
} from "@/lib/openkb-api";

export function InviteClient({ token }: { token: string }) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<InvitationDetail | null>(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isAccepting, setIsAccepting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setMessage("");
      try {
        const next = await getInvitation(token);
        if (!cancelled) {
          setDetail(next);
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(formatError(error, t("Invitation not found.")));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [t, token]);

  async function handleAccept() {
    setIsAccepting(true);
    setMessage("");
    try {
      const result = await acceptInvitation(token);
      setMessage(
        result.status === "awaiting_approval"
          ? t("Invitation accepted. Waiting for approval.")
          : t("Invitation accepted.")
      );
    } catch (error) {
      if (isUnauthorized(error)) {
        window.location.href = `/login?next=${encodeURIComponent(`/invite/${token}`)}`;
        return;
      }
      setMessage(formatError(error, t("Invitation accept failed.")));
    } finally {
      setIsAccepting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 py-10">
      <div className="absolute right-6 top-6">
        <LanguageSwitcher />
      </div>
      <section className="w-full max-w-lg rounded-md border border-zinc-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-medium uppercase text-emerald-700">{t("Invitation")}</p>
        <h1 className="mt-2 text-2xl font-semibold">{t("Join OpenKB")}</h1>
        {isLoading ? (
          <p className="mt-4 text-sm text-zinc-500">{t("Loading...")}</p>
        ) : detail ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-md bg-zinc-50 p-4">
              <p className="text-sm text-zinc-500">{t("You were invited to")}</p>
              <p className="mt-1 text-lg font-semibold">{detail.object.title}</p>
              <p className="mt-1 text-sm text-zinc-500">
                {t("Role")}: {t(detail.invitation.role)}
              </p>
            </div>
            <button
              className="inline-flex h-10 items-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white hover:bg-zinc-800"
              disabled={isAccepting || detail.invitation.status !== "pending"}
              onClick={() => void handleAccept()}
              type="button"
            >
              {isAccepting ? t("Accepting...") : t("Accept invitation")}
            </button>
            <Link
              className="ml-3 text-sm font-medium text-zinc-600 hover:text-zinc-950"
              href="/app"
            >
              {t("Back to workspace")}
            </Link>
          </div>
        ) : null}
        {message ? <p className="mt-4 text-sm text-zinc-700">{message}</p> : null}
      </section>
    </main>
  );
}

function formatError(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) {
    return error.body.message || error.body.error || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}
