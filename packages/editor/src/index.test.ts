import { describe, expect, it } from "vitest";

import {
  createEditorSavePayload,
  EDITOR_FEATURES,
  ENABLED_MILKDOWN_PRESETS,
  extractMarkdownOutline,
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

  it("rejects source features that do not have Phase 5 plugins", () => {
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

![asset](asset://abc)`);

    expect(validation.ok).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toEqual([
      "UNSUPPORTED_MERMAID",
      "UNSUPPORTED_CALLOUT",
      "UNSUPPORTED_CALLOUT",
      "UNSUPPORTED_LATEX_BLOCK",
      "UNSUPPORTED_LATEX_BLOCK",
      "UNSUPPORTED_ASSET_URI"
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
});
