import { describe, expect, it } from "vitest";

import {
  DEFAULT_IMPORT_FORMAT_ROUTES,
  convertImportSource,
  detectImportFormat,
  encryptImportToolSecret,
  getImportToolRuntimeConfig,
  getImportToolSecretLast4,
  toolSupportsFormat
} from "./index";

describe("@openkb/import-tools", () => {
  it("detects complex import formats and exposes default routes", () => {
    expect(detectImportFormat("manual.pdf")).toBe("pdf");
    expect(detectImportFormat("slides.pptx")).toBe("pptx");
    expect(detectImportFormat("scan.png", "image/png")).toBe("image");
    expect(DEFAULT_IMPORT_FORMAT_ROUTES.docx).toEqual({
      primaryTool: "markitdown",
      fallbackTools: ["pandoc", "mineru"]
    });
    expect(toolSupportsFormat("pandoc", "pdf")).toBe(false);
    expect(toolSupportsFormat("tesseract_ocr", "image")).toBe(true);
  });

  it("falls back between configured adapters and records attempted tools", async () => {
    const result = await convertImportSource({
      filename: "paper.pdf",
      content: Buffer.from("%PDF mock"),
      converter: "auto",
      runtimeConfig: getImportToolRuntimeConfig(
        {},
        [
          {
            tool_key: "markitdown",
            enabled: true,
            mode: "local_cli",
            endpoint: null,
            command: "markitdown",
            timeout_ms: 1000,
            max_file_mb: 100,
            encrypted_api_key: null,
            api_key_last4: null,
            options: {},
            updated_by: "test"
          },
          {
            tool_key: "mineru",
            enabled: true,
            mode: "http_api",
            endpoint: "https://mineru.example/convert",
            command: null,
            timeout_ms: 1000,
            max_file_mb: 100,
            encrypted_api_key: null,
            api_key_last4: null,
            options: {},
            updated_by: "test"
          }
        ],
        []
      ),
      adapters: {
        markitdown: async () => {
          throw new Error("missing optional dependency");
        },
        mineru: async () => ({
          title: "Paper",
          markdown: "# Paper\n\nConverted by MinerU.",
          warnings: [],
          metadata: { mock: true },
          assets: []
        })
      }
    });

    expect(result.converter).toBe("mineru");
    expect(result.markdown).toContain("Converted by MinerU.");
    expect(result.warnings[0]?.message).toContain("missing optional dependency");
    expect(result.metadata).toMatchObject({
      selected_tool: "mineru",
      attempted_tools: ["markitdown", "mineru"]
    });
  });

  it("encrypts secrets and only exposes last4 in metadata helpers", () => {
    const encrypted = encryptImportToolSecret("mineru-secret-key", "test-key");
    expect(encrypted).not.toContain("mineru-secret-key");
    expect(getImportToolSecretLast4("mineru-secret-key")).toBe("-key");
  });

  it("does not let an unrelated broken tool secret block a successful route", async () => {
    const result = await convertImportSource({
      filename: "paper.pdf",
      content: Buffer.from("%PDF mock"),
      converter: "auto",
      runtimeConfig: getImportToolRuntimeConfig(
        { OPENKB_CONFIG_ENCRYPTION_KEY: "new-key" },
        [
          {
            tool_key: "markitdown",
            enabled: true,
            mode: "local_cli",
            endpoint: null,
            command: "markitdown",
            timeout_ms: 1000,
            max_file_mb: 100,
            encrypted_api_key: null,
            api_key_last4: null,
            options: {},
            updated_by: "test"
          },
          {
            tool_key: "mineru",
            enabled: true,
            mode: "http_api",
            endpoint: "https://mineru.example/convert",
            command: null,
            timeout_ms: 1000,
            max_file_mb: 100,
            encrypted_api_key: encryptImportToolSecret("old-mineru-key", "old-key"),
            api_key_last4: "-key",
            options: {},
            updated_by: "test"
          }
        ],
        []
      ),
      adapters: {
        markitdown: async () => ({
          title: "Paper",
          markdown: "# Paper\n\nConverted by MarkItDown.",
          warnings: [],
          metadata: { mock: true },
          assets: []
        })
      }
    });

    expect(result.converter).toBe("markitdown");
    expect(result.markdown).toContain("Converted by MarkItDown.");
  });

  it("records a selected tool secret failure and continues to fallback", async () => {
    const result = await convertImportSource({
      filename: "paper.pdf",
      content: Buffer.from("%PDF mock"),
      converter: "auto",
      runtimeConfig: getImportToolRuntimeConfig(
        { OPENKB_CONFIG_ENCRYPTION_KEY: "new-key" },
        [
          {
            tool_key: "markitdown",
            enabled: true,
            mode: "local_cli",
            endpoint: null,
            command: "markitdown",
            timeout_ms: 1000,
            max_file_mb: 100,
            encrypted_api_key: encryptImportToolSecret("old-markitdown-key", "old-key"),
            api_key_last4: "-key",
            options: {},
            updated_by: "test"
          },
          {
            tool_key: "mineru",
            enabled: true,
            mode: "http_api",
            endpoint: "https://mineru.example/convert",
            command: null,
            timeout_ms: 1000,
            max_file_mb: 100,
            encrypted_api_key: null,
            api_key_last4: null,
            options: {},
            updated_by: "test"
          }
        ],
        []
      ),
      adapters: {
        mineru: async () => ({
          title: "Paper",
          markdown: "# Paper\n\nConverted by MinerU.",
          warnings: [],
          metadata: { mock: true },
          assets: []
        })
      }
    });

    expect(result.converter).toBe("mineru");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "IMPORT_TOOL_AUTH_FAILED"
        })
      ])
    );
  });
});
