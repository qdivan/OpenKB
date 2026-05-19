import { describe, expect, it } from "vitest";

import {
  buildMarkdownAssetIndexEntries,
  chunkMarkdown,
  chunkMarkdownForIndex,
  convertImportFile,
  extractMarkdownAssetReferencesForIndex,
  MarkdownConversionError,
  resolveImportConverter
} from "./index";

describe("@openkb/markdown import converters", () => {
  it("converts Markdown and rejects unsupported dialect during import validation", () => {
    expect(
      convertImportFile({
        filename: "Roadmap.md",
        content: "# Roadmap\n\n- Ship Phase 6"
      })
    ).toMatchObject({
      converter: "markdown",
      title: "Roadmap",
      markdown: "# Roadmap\n\n- Ship Phase 6"
    });

    expect(() =>
      convertImportFile({
        filename: "diagram.md",
        content: "```mermaid\ngraph TD\n```"
      })
    ).toThrow(MarkdownConversionError);
  });

  it("converts text, HTML, and CSV into editable Markdown", () => {
    expect(
      convertImportFile({
        filename: "notes.txt",
        content: "Hello\n\n# Not a heading"
      }).markdown
    ).toContain("\\# Not a heading");

    expect(
      convertImportFile({
        filename: "page.html",
        content: "<h1>Title</h1><p>Hello <strong>OpenKB</strong></p>"
      }).markdown
    ).toContain("**OpenKB**");

    expect(
      convertImportFile({
        filename: "table.csv",
        content: "Name,Value\nOpenKB,Markdown"
      }).markdown
    ).toContain("| Name | Value |");
  });

  it("returns a stable unavailable converter error for Office/PDF/images", () => {
    expect(() => resolveImportConverter({ filename: "deck.pptx", content: "" })).toThrow(
      MarkdownConversionError
    );
    try {
      resolveImportConverter({ filename: "deck.pptx", content: "" });
    } catch (error) {
      expect(error).toMatchObject({
        code: "CONVERTER_UNAVAILABLE",
        warnings: [
          {
            code: "CONVERTER_UNAVAILABLE"
          }
        ]
      });
    }
  });

  it("chunks Markdown with heading paths and plain text", () => {
    const chunks = chunkMarkdown(`# A

Intro

## B

Details`);

    expect(chunks).toEqual([
      expect.objectContaining({
        ordinal: 0,
        heading_path: ["A"],
        content_text: "A Intro"
      }),
      expect.objectContaining({
        ordinal: 1,
        heading_path: ["A", "B"],
        content_text: "B Details"
      })
    ]);
  });

  it("builds hierarchical parent and child chunks with stable ordinals and ranges", () => {
    const chunks = chunkMarkdownForIndex(
      `# Guide

Intro paragraph about OpenKB.

Second paragraph with retrieval details.

## Details

Child chunks keep searchable text.`,
      {
        mode: "parent_child",
        parent_mode: "paragraph",
        parent_delimiter: "\n\n",
        child_delimiter: "\n\n",
        parent_max_characters: 70,
        child_max_characters: 44,
        child_overlap_characters: 8,
        settings_revision: 3
      }
    );
    const parents = chunks.filter((chunk) => chunk.chunk_type === "parent");
    const children = chunks.filter((chunk) => chunk.chunk_type === "child");

    expect(chunks.map((chunk) => chunk.ordinal)).toEqual(chunks.map((_, index) => index));
    expect(parents.length).toBeGreaterThan(1);
    expect(children.length).toBeGreaterThanOrEqual(parents.length);
    expect(parents[0]).toMatchObject({
      chunk_type: "parent",
      parent_ordinal: 0,
      child_ordinal: null,
      settings_revision: 3,
      start_line: 1
    });
    expect(parents[0]?.start_char).toBeGreaterThanOrEqual(0);
    expect(children[0]).toMatchObject({
      chunk_type: "child",
      parent_ordinal: 0,
      child_ordinal: 0,
      settings_revision: 3
    });
    expect(children.every((chunk) => typeof chunk.parent_local_id === "string")).toBe(true);
  });

  it("supports full document parent context with multiple searchable children", () => {
    const chunks = chunkMarkdownForIndex("One long paragraph. ".repeat(16), {
      mode: "parent_child",
      parent_mode: "full_doc",
      child_max_characters: 80,
      child_overlap_characters: 12
    });
    const parents = chunks.filter((chunk) => chunk.chunk_type === "parent");
    const children = chunks.filter((chunk) => chunk.chunk_type === "child");

    expect(parents).toHaveLength(1);
    expect(children.length).toBeGreaterThan(1);
    expect(children.every((chunk) => chunk.parent_ordinal === 0)).toBe(true);
    expect(parents[0]?.content_text).toContain("One long paragraph");
  });

  it("drops break-only parent-child segments", () => {
    const chunks = chunkMarkdownForIndex("测试\n\n<br />\n\n测试", {
      mode: "parent_child",
      parent_mode: "paragraph",
      parent_delimiter: "\n\n",
      child_delimiter: "\n\n",
      parent_max_characters: 20,
      child_max_characters: 20
    });

    expect(chunks).not.toHaveLength(0);
    expect(chunks.every((chunk) => !chunk.content_markdown.includes("<br"))).toBe(true);
    expect(chunks.every((chunk) => chunk.content_text.trim().length > 0)).toBe(true);
  });

  it("keeps asset-only Markdown as meaningful retrieval source", () => {
    const markdown = "![](asset://asset_123)";
    const textChunks = chunkMarkdownForIndex(markdown, {
      doc_form: "text_model",
      process_rule_mode: "custom",
      process_rule: {
        segmentation: { separator: "\n\n", max_tokens: 500, chunk_overlap: 0 }
      }
    });
    const parentChildChunks = chunkMarkdownForIndex(markdown, {
      mode: "parent_child",
      parent_mode: "paragraph",
      parent_delimiter: "\n\n",
      child_delimiter: "\n\n",
      parent_max_characters: 500,
      child_max_characters: 500
    });

    expect(textChunks.some((chunk) => chunk.content_markdown.includes("asset://asset_123"))).toBe(
      true
    );
    expect(
      parentChildChunks.some((chunk) => chunk.content_markdown.includes("asset://asset_123"))
    ).toBe(true);
  });

  it("maps Dify text_model to general chunks and qa_model to question chunks", () => {
    const textChunks = chunkMarkdownForIndex("# A\n\nBody", {
      doc_form: "text_model",
      settings_revision: 4
    });
    expect(textChunks.every((chunk) => chunk.chunk_type === "general")).toBe(true);
    expect(textChunks[0]?.settings_revision).toBe(4);

    const qaChunks = chunkMarkdownForIndex("", {
      doc_form: "qa_model",
      settings_revision: 5,
      qa_pairs: [
        {
          id: "qa-1",
          question: "Who visited the cottage?",
          answer: "Liu Bei visited Zhuge Liang.",
          source: "mock",
          generated_mode: "mock"
        }
      ]
    });
    expect(qaChunks).toHaveLength(1);
    expect(qaChunks[0]).toMatchObject({
      chunk_type: "general",
      content_text: "Who visited the cottage?",
      content_markdown: expect.stringContaining("Liu Bei visited Zhuge Liang."),
      settings_revision: 5,
      metadata: expect.objectContaining({
        doc_form: "qa_model",
        qa_pair_id: "qa-1",
        qa_question: "Who visited the cottage?",
        qa_answer: "Liu Bei visited Zhuge Liang.",
        qa_source: "mock",
        qa_generated_mode: "mock"
      })
    });
  });

  it("applies Dify custom segmentation and preprocessing rules for text_model chunks", () => {
    const chunks = chunkMarkdownForIndex(
      "Alpha    beta contact me@example.com.\n\nGamma https://example.com/page delta.",
      {
        doc_form: "text_model",
        process_rule_mode: "custom",
        process_rule: {
          pre_processing_rules: [
            { id: "remove_extra_spaces", enabled: true },
            { id: "remove_urls_emails", enabled: true }
          ],
          segmentation: { separator: "\n\n", max_tokens: 20, chunk_overlap: 6 }
        },
        settings_revision: 9
      }
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.content_text).toContain("Alpha beta contact");
    expect(chunks.map((chunk) => chunk.content_text).join(" ")).not.toContain("example.com");
    expect(chunks.map((chunk) => chunk.metadata)).toContainEqual(
      expect.objectContaining({
        doc_form: "text_model",
        process_rule_mode: "custom",
        chunk_type: "general",
        settings_revision: 9
      })
    );
  });

  it("uses automatic defaults without persisted custom process_rule values", () => {
    const chunks = chunkMarkdownForIndex("A paragraph. ".repeat(220), {
      doc_form: "text_model",
      process_rule_mode: "automatic",
      process_rule: {
        segmentation: { separator: "###", max_tokens: 9999, chunk_overlap: 0 }
      },
      settings_revision: 2
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.settings_revision === 2)).toBe(true);
  });

  it("extracts asset images, asset attachments, and external images for derived indexes", () => {
    const references = extractMarkdownAssetReferencesForIndex(`# Assets

![Diagram](asset://asset_123)
[Spec PDF](asset://asset_pdf)
![External](https://img.example.com/a.png)

\`\`\`md
![ignored](asset://asset_ignored)
\`\`\``);

    expect(references).toEqual([
      expect.objectContaining({
        ordinal: 0,
        kind: "image",
        assetId: "asset_123",
        altText: "Diagram",
        rawUrl: "asset://asset_123",
        start_line: 3
      }),
      expect.objectContaining({
        ordinal: 1,
        kind: "attachment",
        assetId: "asset_pdf",
        caption: "Spec PDF",
        rawUrl: "asset://asset_pdf",
        start_line: 4
      }),
      expect.objectContaining({
        ordinal: 2,
        kind: "external_image",
        assetId: null,
        externalUrl: "https://img.example.com/a.png",
        altText: "External",
        start_line: 5
      })
    ]);
    expect(references.every((reference) => reference.start_char < reference.end_char)).toBe(true);

    const entries = buildMarkdownAssetIndexEntries({
      markdown: "# Assets\n\n![Diagram](asset://asset_123)",
      chunks: [
        {
          id: "segment_1",
          ordinal: 0,
          chunk_type: "general",
          parent_chunk_id: null,
          settings_revision: 7,
          start_line: 1,
          end_line: 3,
          start_char: 0,
          end_char: 40,
          parent_ordinal: null,
          child_ordinal: null,
          heading_path: ["Assets"],
          content_text: "Assets Diagram"
        }
      ],
      assetsById: new Map([
        [
          "asset_123",
          {
            id: "asset_123",
            filename: "diagram.png",
            mime_type: "image/png",
            size_bytes: 1234,
            checksum_sha256: "sha"
          }
        ]
      ]),
      createId: (() => {
        let next = 0;
        return () => `id_${++next}`;
      })()
    });
    expect(entries[0]?.binding).toMatchObject({
      source_chunk_id: "segment_1",
      asset_id: "asset_123",
      kind: "image"
    });
    expect(entries[0]?.chunk.metadata).toMatchObject({
      hit_type: "image",
      doc_type: "image",
      segment_attachment_id: entries[0]?.binding.id,
      attachment_info: {
        id: "asset_123",
        name: "diagram.png",
        extension: ".png",
        mime_type: "image/png",
        size: "1234"
      }
    });
  });

  it("uses Dify-compatible recursive automatic splitting and code point length", () => {
    const chunks = chunkMarkdownForIndex(
      `${"甲".repeat(240)}。${"乙".repeat(240)}。${"😀".repeat(80)}。${"丙".repeat(240)}`,
      {
        doc_form: "text_model",
        process_rule_mode: "automatic"
      }
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.content_markdown.endsWith("。")).toBe(true);
    expect(chunks.every((chunk) => Array.from(chunk.content_markdown).length <= 550)).toBe(true);
  });

  it("uses Dify-compatible fixed separator before recursive fallback", () => {
    const chunks = chunkMarkdownForIndex(
      `Alpha section\n---CUT---\n${"Beta sentence. ".repeat(80)}\n---CUT---\nGamma section`,
      {
        doc_form: "text_model",
        process_rule_mode: "custom",
        process_rule: {
          segmentation: { separator: "\n---CUT---\n", max_tokens: 120, chunk_overlap: 20 }
        }
      }
    );

    expect(chunks[0]?.content_text).toContain("Alpha section");
    expect(chunks.some((chunk) => chunk.content_text.includes("Beta sentence"))).toBe(true);
    expect(chunks.some((chunk) => chunk.content_text.includes("---CUT---"))).toBe(false);
    expect(chunks.length).toBeGreaterThan(3);
  });

  it("preserves spaces when custom sentence splitting falls back recursively", () => {
    const chunks = chunkMarkdownForIndex(
      `Vite aims to support the most common patterns to build web apps, but it avoids supporting every possible edge case. ${"The fallback keeps readable words intact. ".repeat(12)}`,
      {
        doc_form: "text_model",
        process_rule_mode: "custom",
        process_rule: {
          segmentation: { separator: ". ", max_tokens: 80, chunk_overlap: 10 }
        }
      }
    );
    const markdown = chunks.map((chunk) => chunk.content_markdown).join("\n");

    expect(markdown).toContain("Vite aims to support");
    expect(markdown).not.toContain("Viteaims");
    expect(markdown).not.toContain("webapps");
  });

  it("does not split ordered-list markers when custom separator is an English period", () => {
    const chunks = chunkMarkdownForIndex(
      `1. Install OpenKB with Docker.\n2. Configure Dify retrieval.\n\n${"This sentence exercises period fallback. ".repeat(10)}`,
      {
        doc_form: "text_model",
        process_rule_mode: "custom",
        process_rule: {
          segmentation: { separator: ". ", max_tokens: 90, chunk_overlap: 10 }
        }
      }
    );
    const markdown = chunks.map((chunk) => chunk.content_markdown).join("\n");

    expect(markdown).toContain("1. Install OpenKB");
    expect(markdown).toContain("2. Configure Dify");
    expect(markdown).not.toContain("\n1\n");
    expect(markdown).not.toContain("\n2\n");
  });

  it("keeps markdown links and images when Dify URL/email cleanup is enabled", () => {
    const chunks = chunkMarkdownForIndex(
      "Alpha   beta user@example.com https://bare.example/path [keep](https://link.example/a) ![img](https://image.example/i.png)",
      {
        doc_form: "text_model",
        process_rule_mode: "custom",
        process_rule: {
          pre_processing_rules: [
            { id: "remove_extra_spaces", enabled: true },
            { id: "remove_urls_emails", enabled: true }
          ],
          segmentation: { separator: "\n", max_tokens: 500, chunk_overlap: 50 }
        }
      }
    );
    const markdown = chunks.map((chunk) => chunk.content_markdown).join("\n");

    expect(markdown).toContain("Alpha beta");
    expect(markdown).not.toContain("user@example.com");
    expect(markdown).not.toContain("https://bare.example/path");
    expect(markdown).toContain("[keep](https://link.example/a)");
    expect(markdown).toContain("![img](https://image.example/i.png)");
  });

  it("preserves Markdown structural syntax in Dify-compatible chunks", () => {
    const chunks = chunkMarkdownForIndex(
      `# Heading

> Quote

\`\`\`ts
const value = 1;
\`\`\`

- first
1. second

![img](https://image.example/i.png)
[link](https://link.example/a)`,
      {
        doc_form: "text_model",
        process_rule_mode: "custom",
        process_rule: {
          segmentation: { separator: "\n\n", max_tokens: 120, chunk_overlap: 0 }
        }
      }
    );
    const markdown = chunks.map((chunk) => chunk.content_markdown).join("\n\n");

    expect(markdown).toContain("# Heading");
    expect(markdown).toContain("> Quote");
    expect(markdown).toContain("```ts");
    expect(markdown).toContain("- first");
    expect(markdown).toContain("1. second");
    expect(markdown).toContain("![img](https://image.example/i.png)");
    expect(markdown).toContain("[link](https://link.example/a)");
  });
});
