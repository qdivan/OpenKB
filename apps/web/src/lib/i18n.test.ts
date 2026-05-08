import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  detectBrowserLocale,
  interpolateTranslation,
  normalizeLocale,
  translate
} from "./i18n";

describe("i18n helpers", () => {
  it("normalizes supported browser locales", () => {
    expect(normalizeLocale("zh-CN")).toBe("zh-CN");
    expect(normalizeLocale("zh-TW")).toBe("zh-CN");
    expect(normalizeLocale("zh")).toBe("zh-CN");
    expect(normalizeLocale("en-US")).toBe("en");
    expect(normalizeLocale("fr-FR")).toBeNull();
  });

  it("detects Chinese from browser language candidates and otherwise falls back to English", () => {
    expect(detectBrowserLocale("en-US", ["zh-CN", "en-US"])).toBe("zh-CN");
    expect(detectBrowserLocale("zh-TW")).toBe("zh-CN");
    expect(detectBrowserLocale("de-DE")).toBe(DEFAULT_LOCALE);
  });

  it("interpolates values without replacing missing placeholders", () => {
    expect(interpolateTranslation("Hello {name}, {missing}", { name: "OpenKB" })).toBe(
      "Hello OpenKB, {missing}"
    );
  });

  it("uses English text as fallback when a translation is missing", () => {
    expect(translate("zh-CN", "A missing button")).toBe("A missing button");
  });

  it("translates known keys and interpolates dynamic values", () => {
    expect(translate("zh-CN", "Language")).toBe("语言");
    expect(
      translate("zh-CN", "Email verified. Account status: {status}.", { status: "active" })
    ).toBe("邮箱已验证。账号状态：active。");
  });
});
