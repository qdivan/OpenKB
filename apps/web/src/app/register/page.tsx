"use client";

import { useState } from "react";

import { LanguageSwitcher } from "@/components/language-switcher";
import { authApiUrl } from "@/lib/auth-api";
import { useI18n } from "@/lib/i18n-provider";

export default function RegisterPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage("");

    let body: { requires_email_verification?: boolean; message?: string };
    try {
      const response = await fetch(authApiUrl("/api/auth/register"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          display_name: displayName || undefined
        })
      });
      body = await response.json();

      if (!response.ok) {
        setMessage(body.message || t("Registration failed."));
        return;
      }
    } catch {
      setMessage(t("API service is unreachable. Please confirm the API server is running."));
      return;
    } finally {
      setIsSubmitting(false);
    }

    setMessage(
      body.requires_email_verification
        ? t("Check the development outbox for your verification link.")
        : t("Registration complete. You can log in now.")
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 py-10">
      <div className="absolute right-6 top-6">
        <LanguageSwitcher />
      </div>
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-md border border-zinc-200 bg-white p-6 shadow-sm"
      >
        <h1 className="text-2xl font-semibold">{t("Create account")}</h1>
        <label className="mt-6 block text-sm font-medium text-zinc-700">
          {t("Email")}
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-2 w-full rounded-md border border-zinc-300 px-3 py-2"
            autoComplete="email"
            type="email"
            required
          />
        </label>
        <label className="mt-4 block text-sm font-medium text-zinc-700">
          {t("Display name")}
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className="mt-2 w-full rounded-md border border-zinc-300 px-3 py-2"
            autoComplete="name"
            type="text"
          />
        </label>
        <label className="mt-4 block text-sm font-medium text-zinc-700">
          {t("Password")}
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-2 w-full rounded-md border border-zinc-300 px-3 py-2"
            autoComplete="new-password"
            type="password"
            minLength={8}
            required
          />
        </label>
        <button
          className="mt-6 w-full rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:bg-zinc-400"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? t("Creating...") : t("Register")}
        </button>
        {message ? <p className="mt-4 text-sm text-zinc-700">{message}</p> : null}
      </form>
    </main>
  );
}
