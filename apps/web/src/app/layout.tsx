import type { Metadata } from "next";

import { DialogProvider } from "@/components/dialog-provider";
import { I18nProvider } from "@/lib/i18n-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: "OpenKB",
  description: "OpenKB monorepo scaffold"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <I18nProvider>
          <DialogProvider>{children}</DialogProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
