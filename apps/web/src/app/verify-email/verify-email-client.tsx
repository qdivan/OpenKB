"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { authApiUrl } from "@/lib/auth-api";

export default function VerifyEmailClient() {
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("Verifying...");

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setMessage("Verification token is missing.");
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
          throw new Error(body.message || "Email verification failed.");
        }
        setMessage(`Email verified. Account status: ${body.status}.`);
      })
      .catch((error: Error) => setMessage(error.message));
  }, [searchParams]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 py-10">
      <section className="w-full max-w-sm rounded-md border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Verify email</h1>
        <p className="mt-4 text-sm text-zinc-700">{message}</p>
      </section>
    </main>
  );
}
