"use client";

import { Suspense } from "react";

import { useI18n } from "@/lib/i18n-provider";

import PasswordResetClient from "./password-reset-client";

export default function PasswordResetPage() {
  return (
    <Suspense fallback={<PasswordResetFallback />}>
      <PasswordResetClient />
    </Suspense>
  );
}

function PasswordResetFallback() {
  const { t } = useI18n();
  return <main className="p-8 text-sm text-zinc-600">{t("Loading...")}</main>;
}
