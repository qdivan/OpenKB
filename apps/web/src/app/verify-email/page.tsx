"use client";

import { Suspense } from "react";

import { useI18n } from "@/lib/i18n-provider";

import VerifyEmailClient from "./verify-email-client";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<VerifyEmailFallback />}>
      <VerifyEmailClient />
    </Suspense>
  );
}

function VerifyEmailFallback() {
  const { t } = useI18n();
  return <main className="p-8 text-sm text-zinc-600">{t("Verifying...")}</main>;
}
