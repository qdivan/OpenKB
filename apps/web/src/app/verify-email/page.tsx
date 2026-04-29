import { Suspense } from "react";

import VerifyEmailClient from "./verify-email-client";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<main className="p-8 text-sm text-zinc-600">Verifying...</main>}>
      <VerifyEmailClient />
    </Suspense>
  );
}
