import { parse } from "csv-parse/sync";
import TurndownService from "turndown";

import {
  extractMarkdownOutline,
  extractMarkdownPlainText,
  normalizeMarkdownSource,
  validateMarkdownForImport,
  type MarkdownValidationIssue
} from "@openkb/editor";

export const MARKDOWN_PACKAGE_NAME = "@openkb/markdown";
export const MARKDOWN_DIALECT_OWNER = "milkdown";
export const DEFAULT_CHUNK_MAX_CHARACTERS = 1800;

export type ImportConverterName = "markdown" | "text" | "html" | "csv";
export type RequestedImportConverter = "auto" | ImportConverterName;

export type ImportConversionWarning = {
  code: string;
  message: string;
};

export type ConvertImportInput = {
  filename: string;
  mimeType?: string;
  content: Buffer | Uint8Array | string;
  converter?: RequestedImportConverter;
};

export type ImportConversionResult = {
  converter: ImportConverterName;
  title: string;
  markdown: string;
  warnings: ImportConversionWarning[];
};

export type MarkdownChunk = {
  ordinal: number;
  heading_path: string[];
  content_text: string;
  content_markdown: string;
  token_count: number;
  metadata: {
    start_line: number;
    end_line: number;
  };
};

export type MarkdownConversionErrorCode =
  | "CONVERTER_UNAVAILABLE"
  | "CONVERSION_FAILED"
  | "MARKDOWN_DIALECT_ERROR";

export class MarkdownConversionError extends Error {
  constructor(
    public readonly code: MarkdownConversionErrorCode,
    message: string,
    public readonly warnings: ImportConversionWarning[] = [],
    public readonly issues: MarkdownValidationIssue[] = []
  ) {
    super(message);
  }
}

export type MarkdownPackageStatus = {
  packageName: typeof MARKDOWN_PACKAGE_NAME;
  dialectOwner: typeof MARKDOWN_DIALECT_OWNER;
  customDialectImplemented: false;
  converters: readonly ImportConverterName[];
};

export const SUPPORTED_IMPORT_CONVERTERS = ["markdown", "text", "html", "csv"] as const;

export const markdownPackageStatus: MarkdownPackageStatus = {
  packageName: MARKDOWN_PACKAGE_NAME,
  dialectOwner: MARKDOWN_DIALECT_OWNER,
  customDialectImplemented: false,
  converters: SUPPORTED_IMPORT_CONVERTERS
};

const unsupportedExtensionLabels: Record<string, string> = {
  ".doc": "Word documents require a MarkItDown/Pandoc adapter.",
  ".docx": "Word documents require a MarkItDown/Pandoc adapter.",
  ".ppt": "PowerPoint documents require a MarkItDown/Pandoc adapter.",
  ".pptx": "PowerPoint documents require a MarkItDown/Pandoc adapter.",
  ".xls": "Excel workbooks require a MarkItDown/Pandoc adapter.",
  ".xlsx": "Excel workbooks require a MarkItDown/Pandoc adapter.",
  ".pdf": "PDF import requires a MinerU/Pandoc adapter.",
  ".png": "Images require OCR or an image metadata adapter.",
  ".jpg": "Images require OCR or an image metadata adapter.",
  ".jpeg": "Images require OCR or an image metadata adapter.",
  ".gif": "Images require OCR or an image metadata adapter.",
  ".webp": "Images require OCR or an image metadata adapter."
};

export function convertImportFile(input: ConvertImportInput): ImportConversionResult {
  const converter = resolveImportConverter(input);
  const content = decodeContent(input.content);

  const result =
    converter === "markdown"
      ? convertMarkdown(content, input.filename)
      : converter === "text"
        ? convertText(content, input.filename)
        : converter === "html"
          ? convertHtml(content, input.filename)
          : convertCsv(content, input.filename);

  return validateConvertedMarkdown(result);
}

export function resolveImportConverter(input: ConvertImportInput): ImportConverterName {
  const requested = input.converter ?? "auto";
  if (requested !== "auto") {
    if (isImportConverterName(requested)) {
      return requested;
    }
    throw new MarkdownConversionError("CONVERTER_UNAVAILABLE", "Converter is not supported.", [
      { code: "CONVERTER_UNAVAILABLE", message: `${requested} is not enabled in Phase 6.` }
    ]);
  }

  const extension = getExtension(input.filename);
  if (extension === ".md" || extension === ".markdown") {
    return "markdown";
  }
  if (extension === ".txt") {
    return "text";
  }
  if (extension === ".html" || extension === ".htm") {
    return "html";
  }
  if (extension === ".csv") {
    return "csv";
  }

  const mimeType = input.mimeType?.toLowerCase() ?? "";
  if (mimeType === "text/markdown") {
    return "markdown";
  }
  if (mimeType.startsWith("text/plain")) {
    return "text";
  }
  if (mimeType.includes("html")) {
    return "html";
  }
  if (mimeType.includes("csv")) {
    return "csv";
  }

  const message =
    unsupportedExtensionLabels[extension] ?? "No enabled Phase 6 converter matches this file type.";
  throw new MarkdownConversionError("CONVERTER_UNAVAILABLE", "Converter is not available.", [
    { code: "CONVERTER_UNAVAILABLE", message }
  ]);
}

export function chunkMarkdown(
  markdownInput: string,
  options: { maxCharacters?: number } = {}
): MarkdownChunk[] {
  const markdown = normalizeMarkdownSource(markdownInput);
  const maxCharacters = options.maxCharacters ?? DEFAULT_CHUNK_MAX_CHARACTERS;
  const outline = extractMarkdownOutline(markdown);
  const headingByLine = new Map(outline.map((item) => [item.line, item]));
  const chunks: MarkdownChunk[] = [];
  let headingPath: string[] = [];
  let buffer: string[] = [];
  let startLine = 1;

  const flush = (endLine: number) => {
    const contentMarkdown = buffer.join("\n").trim();
    if (!contentMarkdown) {
      buffer = [];
      startLine = endLine + 1;
      return;
    }

    const contentText = extractMarkdownPlainText(contentMarkdown);
    chunks.push({
      ordinal: chunks.length,
      heading_path: headingPath.slice(),
      content_text: contentText,
      content_markdown: contentMarkdown,
      token_count: estimateTokenCount(contentText),
      metadata: {
        start_line: startLine,
        end_line: endLine
      }
    });
    buffer = [];
    startLine = endLine + 1;
  };

  markdown.split("\n").forEach((line, index) => {
    const lineNumber = index + 1;
    const heading = headingByLine.get(lineNumber);
    if (heading && buffer.length > 0) {
      flush(lineNumber - 1);
      headingPath = nextHeadingPath(headingPath, heading.level, heading.title);
      startLine = lineNumber;
    } else if (heading) {
      headingPath = nextHeadingPath(headingPath, heading.level, heading.title);
    }

    buffer.push(line);
    if (buffer.join("\n").length >= maxCharacters) {
      flush(lineNumber);
    }
  });
  flush(markdown.split("\n").length);

  if (chunks.length === 0) {
    return [
      {
        ordinal: 0,
        heading_path: [],
        content_text: "",
        content_markdown: "",
        token_count: 0,
        metadata: { start_line: 1, end_line: 1 }
      }
    ];
  }

  return chunks;
}

function convertMarkdown(content: string, filename: string): ImportConversionResult {
  return {
    converter: "markdown",
    title: titleFromFilename(filename),
    markdown: normalizeMarkdownSource(content),
    warnings: []
  };
}

function convertText(content: string, filename: string): ImportConversionResult {
  const title = titleFromFilename(filename);
  const paragraphs = normalizeMarkdownSource(content)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.split("\n").map(escapePlainTextLine).join("\n").trim())
    .filter(Boolean);

  return {
    converter: "text",
    title,
    markdown: [`# ${escapeInlineMarkdown(title)}`, ...paragraphs].join("\n\n"),
    warnings: []
  };
}

function convertHtml(content: string, filename: string): ImportConversionResult {
  const turndown = new TurndownService({
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    headingStyle: "atx"
  });
  const markdown = turndown.turndown(content);

  return {
    converter: "html",
    title: titleFromFilename(filename),
    markdown: normalizeMarkdownSource(markdown),
    warnings: []
  };
}

function convertCsv(content: string, filename: string): ImportConversionResult {
  let rows: string[][];
  try {
    rows = parse(content, {
      bom: true,
      relax_column_count: true,
      skip_empty_lines: false,
      trim: false
    });
  } catch (error) {
    throw new MarkdownConversionError(
      "CONVERSION_FAILED",
      error instanceof Error ? error.message : "CSV conversion failed."
    );
  }

  const title = titleFromFilename(filename);
  if (rows.length === 0) {
    return {
      converter: "csv",
      title,
      markdown: `# ${escapeInlineMarkdown(title)}\n\n_No rows found._`,
      warnings: [{ code: "EMPTY_CSV", message: "CSV file did not contain any rows." }]
    };
  }

  const columnCount = Math.max(...rows.map((row) => row.length), 1);
  const normalizedRows = rows.map((row) =>
    Array.from({ length: columnCount }, (_, index) => row[index] ?? "")
  );
  const [firstRow, ...bodyRows] = normalizedRows;
  const headers = (firstRow ?? []).map((value, index) =>
    value.trim() ? value : `Column ${index + 1}`
  );
  const tableRows = [
    `| ${headers.map(escapeTableCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...bodyRows.map((row) => `| ${row.map(escapeTableCell).join(" | ")} |`)
  ];

  return {
    converter: "csv",
    title,
    markdown: [`# ${escapeInlineMarkdown(title)}`, ...tableRows].join("\n\n"),
    warnings:
      bodyRows.length === 0
        ? [{ code: "CSV_HEADER_ONLY", message: "CSV file only contained a header row." }]
        : []
  };
}

function validateConvertedMarkdown(result: ImportConversionResult): ImportConversionResult {
  const markdown = normalizeMarkdownSource(result.markdown);
  const validation = validateMarkdownForImport(markdown);
  if (!validation.ok) {
    throw new MarkdownConversionError(
      "MARKDOWN_DIALECT_ERROR",
      "Imported Markdown is outside the enabled Milkdown dialect.",
      result.warnings,
      validation.issues
    );
  }

  return { ...result, markdown };
}

function decodeContent(content: Buffer | Uint8Array | string): string {
  return typeof content === "string" ? content : Buffer.from(content).toString("utf8");
}

function isImportConverterName(value: string): value is ImportConverterName {
  return SUPPORTED_IMPORT_CONVERTERS.includes(value as ImportConverterName);
}

function getExtension(filename: string): string {
  const normalized = filename.trim().toLowerCase();
  const dot = normalized.lastIndexOf(".");
  return dot >= 0 ? normalized.slice(dot) : "";
}

function titleFromFilename(filename: string): string {
  const basename =
    filename
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/\.[^.]+$/, "")
      .trim() ?? "";
  return basename || "Imported document";
}

function escapePlainTextLine(line: string): string {
  const escaped = line
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/`/g, "\\`");

  return escaped.replace(/^(\s*)(#{1,6}\s|[-*+]\s|\d+\.\s|>\s?|:::+|\$\$\s*$)/, "$1\\$2");
}

function escapeInlineMarkdown(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+\-.!|>])/g, "\\$1");
}

function escapeTableCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>").trim();
}

function nextHeadingPath(current: string[], level: number, title: string): string[] {
  const path = current.slice(0, Math.max(0, level - 1));
  path[level - 1] = title;
  return path.filter(Boolean);
}

function estimateTokenCount(text: string): number {
  if (!text.trim()) {
    return 0;
  }
  return Math.ceil(text.trim().length / 4);
}
