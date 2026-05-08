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

  it("covers Phase 15.1 workbench and admin stabilization labels", () => {
    expect(translate("zh-CN", "Enter workbench")).toBe("进入工作台");
    expect(translate("zh-CN", "Overview")).toBe("概览");
    expect(translate("zh-CN", "Ready")).toBe("就绪");
    expect(translate("zh-CN", "Probe")).toBe("检测");
    expect(translate("zh-CN", "Search and index controls")).toBe("搜索与索引控制");
    expect(translate("zh-CN", "Enable database setting")).toBe("启用数据库配置");
    expect(translate("zh-CN", "No chunks for this document")).toBe("此文档暂无分块");
    expect(translate("zh-CN", "Open document")).toBe("打开文档");
    expect(translate("zh-CN", "status: {value}", { value: "active" })).toBe("状态：active");
    expect(translate("zh-CN", "visibility: {value}", { value: "workspace" })).toBe(
      "可见性：workspace"
    );
    expect(translate("zh-CN", "Embedding batch size help")).toContain("不是并行请求数");
  });
});
