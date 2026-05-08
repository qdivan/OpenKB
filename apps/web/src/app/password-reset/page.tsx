import { Suspense } from "react";

import PasswordResetClient from "./password-reset-client";

export default function PasswordResetPage() {
  return (
    <Suspense fallback={<main className="p-8 text-sm text-zinc-600">Loading...</main>}>
      <PasswordResetClient />
    </Suspense>
  );
}
