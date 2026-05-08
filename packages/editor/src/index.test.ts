import { describe, expect, it } from "vitest";

import {
  createAssetImageMarkdown,
  createAssetLinkMarkdown,
  createEditorSavePayload,
  createMarkdownDateText,
  clearBasicMarkdownFormatting,
  DISABLED_EDITOR_INSERT_MENU_CAPABILITIES,
  DISABLED_EDITOR_TOOLBAR_CAPABILITIES,
  EDITOR_FEATURES,
  EDITOR_INSERT_MENU_CAPABILITIES,
  EDITOR_TOOLBAR_CAPABILITIES,
  ENABLED_MILKDOWN_PRESETS,
  extractMarkdownPlainText,
  extractMarkdownReferences,
  extractMarkdownOutline,
  getEnabledFeatureRoundTripFixtures,
  MARKDOWN_DIALECT_ERROR,
  normalizeMarkdownSource,
  prepareMarkdownForMilkdown,
  replaceMarkdownText,
  restoreMarkdownFromMilkdown,
  validateMarkdownSource
} from "./index";

describe("@openkb/editor", () => {
  it("defines a non-empty Milkdown feature registry with allowed presets", () => {
    expect(Array.isArray(EDITOR_FEATURES)).toBe(true);
    expect(EDITOR_FEATURES.length).toBeGreaterThan(0);
    expect(new Set(EDITOR_FEATURES.map((feature) => feature.key)).size).toBe(
      EDITOR_FEATURES.length
    );
    expect(EDITOR_FEATURES.every((feature) => feature.enabled)).toBe(true);
    expect(
      EDITOR_FEATURES.every((feature) => ENABLED_MILKDOWN_PRESETS.includes(feature.milkdownPlugin))
    ).toBe(true);
    expect(EDITOR_FEATURES.every((feature) => feature.roundTripMarkdown.length > 0)).toBe(true);
  });

  it("keeps one validation fixture per enabled feature", () => {
    const fixtures = getEnabledFeatureRoundTripFixtures();

    expect(fixtures).toHaveLength(EDITOR_FEATURES.length);
    for (const fixture of fixtures) {
      const normalized = normalizeMarkdownSource(fixture.markdown);
      const validation = validateMarkdownSource(normalized);

      expect(validation, fixture.featureKey).toMatchObject({ ok: true });
      expect(normalizeMarkdownSource(normalized)).toBe(normalized);
    }
  });

  it("keeps toolbar and insert capabilities behind the feature registry", () => {
    const enabledFeatureKeys = new Set(EDITOR_FEATURES.map((feature) => feature.key));
    const enabledCapabilities = [
      ...EDITOR_TOOLBAR_CAPABILITIES,
      ...EDITOR_INSERT_MENU_CAPABILITIES
    ].filter((capability) => capability.status === "enabled");

    expect(EDITOR_TOOLBAR_CAPABILITIES.length).toBeGreaterThan(0);
    expect(EDITOR_INSERT_MENU_CAPABILITIES.length).toBeGreaterThan(0);
    expect(enabledCapabilities.length).toBeGreaterThan(0);
    expect(
      enabledCapabilities.every(
        (capability) => capability.featureKey && enabledFeatureKeys.has(capability.featureKey)
      )
    ).toBe(true);
    expect(
      [...DISABLED_EDITOR_TOOLBAR_CAPABILITIES, ...DISABLED_EDITOR_INSERT_MENU_CAPABILITIES].every(
        (capability) => capability.reason && capability.reason.length > 0
      )
    ).toBe(true);
    expect(EDITOR_TOOLBAR_CAPABILITIES.find((item) => item.key === "clear_format")).toMatchObject({
      status: "enabled",
      featureKey: "paragraph"
    });
    expect(EDITOR_INSERT_MENU_CAPABILITIES.find((item) => item.key === "date")).toMatchObject({
      status: "enabled",
      featureKey: "paragraph"
    });
    expect(
      EDITOR_INSERT_MENU_CAPABILITIES.find((item) => item.key === "file_attachment")
    ).toMatchObject({
      status: "enabled",
      featureKey: "link"
    });

    for (const key of ["font_size", "font_color", "background_color", "alignment", "line_height"]) {
      const capability = EDITOR_TOOLBAR_CAPABILITIES.find((item) => item.key === key);
      expect(capability).toMatchObject({ status: "disabled", markdownNative: false });
    }
  });

  it("extracts markdown outlines while ignoring fenced code", () => {
    const outline = extractMarkdownOutline(`# Title

\`\`\`md
## Ignored
\`\`\`

## Section
### [Linked](openkb://document/abc)
## Section`);

    expect(outline).toEqual([
      { id: "title", level: 1, title: "Title", line: 1 },
      { id: "section", level: 2, title: "Section", line: 7 },
      { id: "linked", level: 3, title: "Linked", line: 8 },
      { id: "section-2", level: 2, title: "Section", line: 9 }
    ]);
  });

  it("extracts plain text and markdown references for search and import", () => {
    const markdown = `# Title

See [Roadmap](openkb://document/doc_123) and [site](https://openkb.local).

![Diagram](asset://asset_123)

- [x] Indexed task`;

    expect(extractMarkdownPlainText(markdown)).toBe(
      "Title See Roadmap and site. Diagram Indexed task"
    );
    expect(extractMarkdownReferences(markdown)).toEqual({
      internalLinks: [
        {
          type: "internal_document",
          documentId: "doc_123",
          label: "Roadmap",
          line: 3,
          rawUrl: "openkb://document/doc_123"
        }
      ],
      assetReferences: [
        {
          type: "asset",
          assetId: "asset_123",
          alt: "Diagram",
          line: 5,
          rawUrl: "asset://asset_123"
        }
      ],
      externalLinks: [
        {
          type: "external",
          url: "https://openkb.local",
          label: "site",
          line: 3
        }
      ]
    });
  });

  it("prepares asset images for Milkdown without losing asset references", () => {
    const source = "![Diagram](asset://asset_123)";
    const prepared = prepareMarkdownForMilkdown(source);

    expect(prepared.assetPlaceholders).toHaveLength(1);
    expect(prepared.markdown).toContain("data:image/svg+xml");
    expect(restoreMarkdownFromMilkdown(prepared.markdown, prepared)).toBe(source);
  });

  it("builds asset image markdown and replaces draft markdown text", () => {
    expect(createAssetImageMarkdown("asset_123", "Diagram [v1]\n")).toBe(
      "![Diagram v1](asset://asset_123)"
    );
    expect(createAssetLinkMarkdown("asset_123", "Report [v1]\n.pdf")).toBe(
      "[Report v1 .pdf](asset://asset_123)"
    );
    expect(createMarkdownDateText(new Date(2026, 4, 8))).toBe("2026-05-08");
    expect(
      clearBasicMarkdownFormatting(
        "**Bold** *em* ~~gone~~ `code` [Link](https://openkb.local) ![Alt](asset://asset_123)"
      )
    ).toEqual({
      markdown: "Bold em gone code Link Alt",
      changed: true
    });

    expect(
      replaceMarkdownText("OpenKB openkb OpenKB", "openkb", "Docs", {
        matchCase: false,
        replaceAll: false
      })
    ).toEqual({ markdown: "Docs openkb OpenKB", count: 1 });
    expect(replaceMarkdownText("OpenKB openkb", "openkb", "Docs")).toEqual({
      markdown: "Docs Docs",
      count: 2
    });
  });

  it("rejects source features that do not have enabled Milkdown plugins", () => {
    const validation = validateMarkdownSource(`# Title

\`\`\`mermaid
graph TD
\`\`\`

:::
callout
:::

$$
x = 1
$$

[bad](javascript:alert(1))
![bad asset](asset://)`);

    expect(validation.ok).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toEqual([
      "UNSUPPORTED_MERMAID",
      "UNSUPPORTED_CALLOUT",
      "UNSUPPORTED_CALLOUT",
      "UNSUPPORTED_LATEX_BLOCK",
      "UNSUPPORTED_LATEX_BLOCK",
      "UNSAFE_LINK_URI",
      "INVALID_ASSET_URI"
    ]);
  });

  it("builds save payloads with normalized markdown and a sha-256 hash", async () => {
    const payload = await createEditorSavePayload({
      document_id: "doc_1",
      base_version_id: "version_1",
      title: "Title",
      markdown: "# Title\r\n"
    });

    expect(payload.markdown).toBe("# Title\n");
    expect(payload.markdown_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("exposes a stable markdown dialect error code", () => {
    expect(MARKDOWN_DIALECT_ERROR).toBe("MARKDOWN_DIALECT_ERROR");
  });
});
