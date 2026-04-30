import { describe, expect, it } from "vitest";

import {
  createEditorSavePayload,
  EDITOR_FEATURES,
  ENABLED_MILKDOWN_PRESETS,
  extractMarkdownPlainText,
  extractMarkdownReferences,
  extractMarkdownOutline,
  getEnabledFeatureRoundTripFixtures,
  MARKDOWN_DIALECT_ERROR,
  normalizeMarkdownSource,
  prepareMarkdownForMilkdown,
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
