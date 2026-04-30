import { describe, expect, it } from "vitest";

import {
  chunkMarkdown,
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
});
