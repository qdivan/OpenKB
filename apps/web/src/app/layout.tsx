import type { Metadata } from "next";

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
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
