import { describe, expect, it } from "vitest";

import {
  chunkMarkdown,
  chunkMarkdownForIndex,
  convertImportFile,
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
      start_line: 1,
      start_char: 0
    });
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
});
