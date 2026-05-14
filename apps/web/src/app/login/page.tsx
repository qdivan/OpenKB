"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";

import { LanguageSwitcher } from "@/components/language-switcher";
import { authApiUrl } from "@/lib/auth-api";
import { useI18n } from "@/lib/i18n-provider";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginShell />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"info" | "error">("error");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    router.prefetch("/app");
  }, [router]);

  useEffect(() => {
    if (searchParams.get("reset") === "success") {
      setMessageTone("info");
      setMessage(t("Password updated. Please log in."));
    }
  }, [searchParams, t]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessageTone("error");
    setMessage("");

    try {
      const response = await fetch(authApiUrl("/api/auth/login"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password })
      });
      const body = await response.json();

      if (!response.ok) {
        setMessage(body.message || t("Login failed."));
        return;
      }
    } catch {
      setMessage(t("API service is unreachable. Please confirm the API server is running."));
      return;
    } finally {
      setIsSubmitting(false);
    }

    const next = getSafeNextPath(new URLSearchParams(window.location.search).get("next"));
    router.replace(next ?? "/app");
  }

  return (
    <LoginShell>
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-md border border-zinc-200 bg-white p-6 shadow-sm"
      >
        <h1 className="text-2xl font-semibold">{t("Log in")}</h1>
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
          {t("Password")}
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-2 w-full rounded-md border border-zinc-300 px-3 py-2"
            autoComplete="current-password"
            type="password"
            required
          />
        </label>
        <button
          className="mt-6 w-full rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:bg-zinc-400"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? t("Signing in...") : t("Log in")}
        </button>
        {message ? (
          <p
            className={`mt-4 text-sm ${
              messageTone === "info" ? "text-emerald-700" : "text-red-600"
            }`}
          >
            {message}
          </p>
        ) : null}
      </form>
    </LoginShell>
  );
}

function LoginShell({ children }: { children?: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 py-10">
      <div className="absolute right-6 top-6">
        <LanguageSwitcher />
      </div>
      {children ?? (
        <div className="h-72 w-full max-w-sm rounded-md border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="h-7 w-28 animate-pulse rounded bg-zinc-100" />
          <div className="mt-8 h-10 animate-pulse rounded bg-zinc-100" />
          <div className="mt-4 h-10 animate-pulse rounded bg-zinc-100" />
          <div className="mt-6 h-10 animate-pulse rounded bg-zinc-900/20" />
        </div>
      )}
    </main>
  );
}

function getSafeNextPath(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }
  return value;
}
