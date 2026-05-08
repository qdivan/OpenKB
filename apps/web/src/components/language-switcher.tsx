"use client";

import { Globe2 } from "lucide-react";

import { SUPPORTED_LOCALES, type Locale } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n-provider";

const localeLabels: Record<Locale, string> = {
  en: "English",
  "zh-CN": "中文"
};

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();

  return (
    <label
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 text-xs font-medium text-zinc-700 shadow-sm transition hover:border-zinc-300 ${
        compact ? "max-w-[116px]" : ""
      }`}
      title={t("Language")}
    >
      <Globe2 className="h-3.5 w-3.5 text-zinc-500" />
      <span className="sr-only">{t("Language")}</span>
      <select
        aria-label={t("Language")}
        className="min-w-0 bg-transparent text-xs outline-none"
        onChange={(event) => setLocale(event.target.value as Locale)}
        value={locale}
      >
        {SUPPORTED_LOCALES.map((nextLocale) => (
          <option key={nextLocale} value={nextLocale}>
            {localeLabels[nextLocale]}
          </option>
        ))}
      </select>
    </label>
  );
}
