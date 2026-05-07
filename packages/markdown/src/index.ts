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
export const DEFAULT_PARENT_CHUNK_MAX_CHARACTERS = 4000;
export const DEFAULT_CHILD_CHUNK_MAX_CHARACTERS = 900;
export const DEFAULT_CHILD_CHUNK_OVERLAP_CHARACTERS = 120;

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
    [key: string]: unknown;
  };
};

export type MarkdownChunkType = "general" | "parent" | "child";
export type MarkdownChunkingMode = "general" | "parent_child";
export type MarkdownParentChunkMode = "paragraph" | "full_doc";

export type MarkdownChunkingSettings = {
  mode?: MarkdownChunkingMode;
  parent_mode?: MarkdownParentChunkMode;
  parent_delimiter?: string;
  child_delimiter?: string;
  parent_max_characters?: number;
  child_max_characters?: number;
  child_overlap_characters?: number;
  settings_revision?: number;
};

export type HierarchicalMarkdownChunk = MarkdownChunk & {
  chunk_type: MarkdownChunkType;
  parent_ordinal: number | null;
  child_ordinal: number | null;
  settings_revision: number;
  start_line: number | null;
  end_line: number | null;
  start_char: number | null;
  end_char: number | null;
  parent_local_id: string | null;
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

export function chunkMarkdownForIndex(
  markdownInput: string,
  settings: MarkdownChunkingSettings = {}
): HierarchicalMarkdownChunk[] {
  const mode = settings.mode ?? "parent_child";
  const settingsRevision = positiveInt(settings.settings_revision, 1);

  if (mode === "general") {
    return chunkMarkdown(markdownInput, {
      maxCharacters: positiveInt(settings.child_max_characters, DEFAULT_CHUNK_MAX_CHARACTERS)
    }).map((chunk) => ({
      ...chunk,
      chunk_type: "general",
      parent_ordinal: null,
      child_ordinal: null,
      settings_revision: settingsRevision,
      start_line: chunk.metadata.start_line,
      end_line: chunk.metadata.end_line,
      start_char: null,
      end_char: null,
      parent_local_id: null
    }));
  }

  return chunkMarkdownParentChild(markdownInput, {
    parentMode: settings.parent_mode ?? "paragraph",
    parentDelimiter: normalizeChunkDelimiter(settings.parent_delimiter),
    childDelimiter: normalizeChunkDelimiter(settings.child_delimiter),
    parentMaxCharacters: positiveInt(
      settings.parent_max_characters,
      DEFAULT_PARENT_CHUNK_MAX_CHARACTERS
    ),
    childMaxCharacters: positiveInt(
      settings.child_max_characters,
      DEFAULT_CHILD_CHUNK_MAX_CHARACTERS
    ),
    childOverlapCharacters: Math.max(
      0,
      Math.min(
        positiveInt(settings.child_overlap_characters, DEFAULT_CHILD_CHUNK_OVERLAP_CHARACTERS),
        positiveInt(settings.child_max_characters, DEFAULT_CHILD_CHUNK_MAX_CHARACTERS) - 1
      )
    ),
    settingsRevision
  });
}

function chunkMarkdownParentChild(
  markdownInput: string,
  options: {
    parentMode: MarkdownParentChunkMode;
    parentDelimiter: string;
    childDelimiter: string;
    parentMaxCharacters: number;
    childMaxCharacters: number;
    childOverlapCharacters: number;
    settingsRevision: number;
  }
): HierarchicalMarkdownChunk[] {
  const markdown = normalizeMarkdownSource(markdownInput);
  const parentChunks =
    options.parentMode === "full_doc"
      ? [
          {
            ordinal: 0,
            heading_path: [],
            content_text: extractMarkdownPlainText(markdown),
            content_markdown: markdown,
            token_count: estimateTokenCount(extractMarkdownPlainText(markdown)),
            metadata: {
              start_line: 1,
              end_line: Math.max(markdown.split("\n").length, 1),
              start_char: 0,
              end_char: markdown.length
            }
          }
        ]
      : chunkMarkdownByDelimiter(markdown, options.parentDelimiter, options.parentMaxCharacters);

  const chunks: HierarchicalMarkdownChunk[] = [];
  let ordinal = 0;
  let searchCursor = 0;

  for (const parent of parentChunks) {
    const parentRange =
      typeof parent.metadata.start_char === "number" && typeof parent.metadata.end_char === "number"
        ? {
            startChar: parent.metadata.start_char,
            endChar: parent.metadata.end_char
          }
        : findMarkdownRange(markdown, parent.content_markdown, searchCursor);
    searchCursor = Math.max(searchCursor, parentRange.endChar ?? searchCursor);
    const parentOrdinal = chunks.filter((chunk) => chunk.chunk_type === "parent").length;
    const parentLocalId = `parent:${parentOrdinal}`;
    chunks.push({
      ...parent,
      ordinal,
      chunk_type: "parent",
      parent_ordinal: parentOrdinal,
      child_ordinal: null,
      settings_revision: options.settingsRevision,
      start_line: parent.metadata.start_line,
      end_line: parent.metadata.end_line,
      start_char: parentRange.startChar,
      end_char: parentRange.endChar,
      parent_local_id: parentLocalId,
      metadata: {
        ...parent.metadata,
        chunk_type: "parent",
        parent_ordinal: parentOrdinal,
        settings_revision: options.settingsRevision
      }
    });
    ordinal += 1;

    const childSegments = splitChildMarkdown(
      parent.content_markdown,
      options.childDelimiter,
      options.childMaxCharacters,
      options.childOverlapCharacters
    );
    for (const [childOrdinal, childMarkdown] of childSegments.entries()) {
      const contentText = extractMarkdownPlainText(childMarkdown);
      const childRange = findMarkdownRange(
        markdown,
        childMarkdown,
        (parentRange.startChar ?? searchCursor) +
          Math.min(parent.content_markdown.length, childOrdinal)
      );
      chunks.push({
        ordinal,
        heading_path: parent.heading_path,
        content_text: contentText,
        content_markdown: childMarkdown,
        token_count: estimateTokenCount(contentText),
        metadata: {
          start_line: parent.metadata.start_line,
          end_line: parent.metadata.end_line,
          chunk_type: "child",
          parent_ordinal: parentOrdinal,
          child_ordinal: childOrdinal,
          settings_revision: options.settingsRevision
        },
        chunk_type: "child",
        parent_ordinal: parentOrdinal,
        child_ordinal: childOrdinal,
        settings_revision: options.settingsRevision,
        start_line: parent.metadata.start_line,
        end_line: parent.metadata.end_line,
        start_char: childRange.startChar,
        end_char: childRange.endChar,
        parent_local_id: parentLocalId
      });
      ordinal += 1;
    }
  }

  return chunks.length > 0 ? chunks : chunkMarkdownForIndex("", { mode: "general" });
}

type MarkdownSegment = {
  content: string;
  startChar: number;
  endChar: number;
  startLine: number;
  endLine: number;
};

function chunkMarkdownByDelimiter(
  markdown: string,
  delimiter: string,
  maxCharacters: number
): MarkdownChunk[] {
  const segments = splitMarkdownSegments(markdown, delimiter).filter((segment) =>
    segment.content.trim()
  );
  const outline = extractMarkdownOutline(markdown);
  const chunks: MarkdownChunk[] = [];
  let group: MarkdownSegment[] = [];

  const flush = () => {
    if (group.length === 0) {
      return;
    }
    const first = group[0]!;
    const last = group[group.length - 1]!;
    const content = markdown.slice(first.startChar, last.endChar).trim();
    const contentText = extractMarkdownPlainText(content);
    chunks.push({
      ordinal: chunks.length,
      heading_path: headingPathAtLine(outline, first.startLine),
      content_text: contentText,
      content_markdown: content,
      token_count: estimateTokenCount(contentText),
      metadata: {
        start_line: first.startLine,
        end_line: last.endLine,
        start_char: first.startChar,
        end_char: last.endChar
      }
    });
    group = [];
  };

  for (const segment of segments) {
    const first = group[0] ?? segment;
    const nextContent = markdown.slice(first.startChar, segment.endChar).trim();
    if (group.length > 0 && nextContent.length > maxCharacters) {
      flush();
    }
    group.push(segment);
  }
  flush();

  if (chunks.length === 0) {
    return [
      {
        ordinal: 0,
        heading_path: [],
        content_text: "",
        content_markdown: "",
        token_count: 0,
        metadata: { start_line: 1, end_line: 1, start_char: 0, end_char: 0 }
      }
    ];
  }

  return chunks;
}

function splitChildMarkdown(
  markdown: string,
  delimiter: string,
  maxCharacters: number,
  overlapCharacters: number
): string[] {
  const blocks = splitMarkdownSegments(markdown, delimiter)
    .map((block) => block.content.trim())
    .filter(Boolean);
  const sourceBlocks = blocks.length > 0 ? blocks : [markdown.trim()].filter(Boolean);
  const chunks: string[] = [];
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join("\n\n").trim();
    if (!content) {
      buffer = [];
      return;
    }
    chunks.push(content);
    buffer = [];
  };

  for (const block of sourceBlocks) {
    if (block.length > maxCharacters) {
      flush();
      for (let index = 0; index < block.length; index += maxCharacters - overlapCharacters) {
        chunks.push(block.slice(index, index + maxCharacters).trim());
      }
      continue;
    }

    const next = [...buffer, block].join("\n\n");
    if (next.length > maxCharacters && buffer.length > 0) {
      const previous = buffer.join("\n\n");
      flush();
      if (overlapCharacters > 0 && previous.length > overlapCharacters) {
        buffer.push(previous.slice(-overlapCharacters), block);
      } else {
        buffer.push(block);
      }
    } else {
      buffer.push(block);
    }
  }

  flush();
  return chunks.length > 0 ? chunks : [""];
}

function splitMarkdownSegments(markdown: string, delimiter: string): MarkdownSegment[] {
  const ranges: Array<{ start: number; end: number }> = [];
  if (delimiter === "\n\n") {
    const separator = /\n{2,}/g;
    let start = 0;
    let match: RegExpExecArray | null;
    while ((match = separator.exec(markdown))) {
      ranges.push({ start, end: match.index });
      start = match.index + match[0].length;
    }
    ranges.push({ start, end: markdown.length });
  } else {
    let start = 0;
    for (;;) {
      const next = markdown.indexOf(delimiter, start);
      if (next < 0) {
        ranges.push({ start, end: markdown.length });
        break;
      }
      ranges.push({ start, end: next });
      start = next + delimiter.length;
    }
  }

  const segments = ranges.flatMap((range) => {
    const trimmed = trimMarkdownRange(markdown, range.start, range.end);
    if (trimmed.start >= trimmed.end) {
      return [];
    }
    return [
      {
        content: markdown.slice(trimmed.start, trimmed.end),
        startChar: trimmed.start,
        endChar: trimmed.end,
        startLine: lineNumberAtChar(markdown, trimmed.start),
        endLine: lineNumberAtChar(markdown, Math.max(trimmed.end - 1, trimmed.start))
      }
    ];
  });

  return segments.length > 0
    ? segments
    : [{ content: "", startChar: 0, endChar: 0, startLine: 1, endLine: 1 }];
}

function trimMarkdownRange(markdown: string, start: number, end: number) {
  let nextStart = start;
  let nextEnd = end;
  while (nextStart < nextEnd && /\s/.test(markdown[nextStart] ?? "")) {
    nextStart += 1;
  }
  while (nextEnd > nextStart && /\s/.test(markdown[nextEnd - 1] ?? "")) {
    nextEnd -= 1;
  }
  return { start: nextStart, end: nextEnd };
}

function lineNumberAtChar(markdown: string, charIndex: number): number {
  return markdown.slice(0, Math.max(0, charIndex)).split("\n").length;
}

function headingPathAtLine(
  outline: Array<{ level: number; title: string; line: number }>,
  line: number
): string[] {
  let path: string[] = [];
  for (const item of outline) {
    if (item.line > line) {
      break;
    }
    path = nextHeadingPath(path, item.level, item.title);
  }
  return path;
}

function findMarkdownRange(
  markdown: string,
  needle: string,
  fromIndex: number
): { startChar: number | null; endChar: number | null } {
  if (!needle) {
    return { startChar: fromIndex, endChar: fromIndex };
  }
  const start = markdown.indexOf(needle, Math.max(0, fromIndex));
  if (start < 0) {
    const fallback = markdown.indexOf(needle);
    if (fallback < 0) {
      return { startChar: null, endChar: null };
    }
    return { startChar: fallback, endChar: fallback + needle.length };
  }
  return { startChar: start, endChar: start + needle.length };
}

function positiveInt(value: number | null | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function normalizeChunkDelimiter(value: string | undefined): string {
  const normalized = value?.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  return normalized && normalized.length > 0 ? normalized : "\n\n";
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
