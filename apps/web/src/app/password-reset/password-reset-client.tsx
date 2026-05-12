"use client";

import { useSearchParams } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

import { LanguageSwitcher } from "@/components/language-switcher";
import { useI18n } from "@/lib/i18n-provider";
import { confirmPasswordReset } from "@/lib/openkb-api";

export default function PasswordResetClient() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token") ?? "", [searchParams]);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState(token ? "" : t("Password reset token is missing."));
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setMessage(t("Password reset token is missing."));
      return;
    }
    if (password !== confirmPassword) {
      setMessage(t("Passwords do not match."));
      return;
    }

    setIsSubmitting(true);
    setMessage("");
    try {
      await confirmPasswordReset({ token, password });
      setMessage(t("Password updated. You can log in now."));
      setPassword("");
      setConfirmPassword("");
    } catch (error) {
      setMessage(
        error instanceof TypeError
          ? t("API service is unreachable. Please confirm the API server is running.")
          : error instanceof Error
            ? error.message
            : t("Password reset failed.")
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 py-10">
      <div className="absolute right-6 top-6">
        <LanguageSwitcher />
      </div>
      <form
        className="w-full max-w-sm rounded-md border border-zinc-200 bg-white p-6 shadow-sm"
        onSubmit={onSubmit}
      >
        <h1 className="text-2xl font-semibold">{t("Set password")}</h1>
        <label className="mt-6 block text-sm font-medium text-zinc-700">
          {t("New password")}
          <input
            autoComplete="new-password"
            className="mt-2 w-full rounded-md border border-zinc-300 px-3 py-2"
            minLength={8}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
        <label className="mt-4 block text-sm font-medium text-zinc-700">
          {t("Confirm password")}
          <input
            autoComplete="new-password"
            className="mt-2 w-full rounded-md border border-zinc-300 px-3 py-2"
            minLength={8}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
            type="password"
            value={confirmPassword}
          />
        </label>
        <button
          className="mt-6 w-full rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:bg-zinc-400"
          disabled={isSubmitting || !token}
          type="submit"
        >
          {isSubmitting ? t("Saving...") : t("Set password")}
        </button>
        {message ? <p className="mt-4 text-sm text-zinc-700">{message}</p> : null}
      </form>
    </main>
  );
}
