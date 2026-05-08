"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { LanguageSwitcher } from "@/components/language-switcher";
import { authApiUrl } from "@/lib/auth-api";
import { useI18n } from "@/lib/i18n-provider";

export default function VerifyEmailClient() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState(t("Verifying..."));

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setMessage(t("Verification token is missing."));
      return;
    }

    void fetch(authApiUrl("/api/auth/verify-email"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token })
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.message || t("Email verification failed."));
        }
        setMessage(t("Email verified. Account status: {status}.", { status: body.status }));
      })
      .catch((error: Error) =>
        setMessage(
          error instanceof TypeError
            ? t("API service is unreachable. Please confirm localhost:4000 is running.")
            : error.message
        )
      );
  }, [searchParams, t]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 py-10">
      <div className="absolute right-6 top-6">
        <LanguageSwitcher />
      </div>
      <section className="w-full max-w-sm rounded-md border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">{t("Verify email")}</h1>
        <p className="mt-4 text-sm text-zinc-700">{message}</p>
      </section>
    </main>
  );
}
