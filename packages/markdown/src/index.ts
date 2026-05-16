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
const DIFY_AUTOMATIC_CHUNK_MAX_CHARACTERS = 500;
const DIFY_AUTOMATIC_CHUNK_OVERLAP_CHARACTERS = 50;
const DIFY_RECURSIVE_SEPARATORS = ["\n\n", "。", ". ", " ", ""] as const;

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
    start_line: number | null;
    end_line: number | null;
    [key: string]: unknown;
  };
};

export type MarkdownChunkType = "general" | "parent" | "child";
export type MarkdownChunkingMode = "general" | "parent_child";
export type DifyDocForm = "text_model" | "hierarchical_model" | "qa_model";
export type DifyIndexingTechnique = "economy" | "high_quality";
export type DifyProcessRuleMode = "automatic" | "custom" | "hierarchical";
export type MarkdownParentChunkMode = "paragraph" | "full_doc";

export type MarkdownQaPair = {
  id?: string;
  question: string;
  answer: string;
  source?: "manual" | "csv" | "llm";
  source_chunk_id?: string | null;
};

export type MarkdownChunkingSettings = {
  mode?: MarkdownChunkingMode;
  doc_form?: DifyDocForm;
  indexing_technique?: DifyIndexingTechnique;
  process_rule_mode?: DifyProcessRuleMode;
  process_rule?: unknown;
  parent_mode?: MarkdownParentChunkMode;
  parent_delimiter?: string;
  child_delimiter?: string;
  parent_max_characters?: number;
  chunk_overlap_characters?: number;
  child_max_characters?: number;
  child_overlap_characters?: number;
  settings_revision?: number;
  qa_pairs?: MarkdownQaPair[];
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
  const docForm =
    settings.doc_form ?? (settings.mode === "general" ? "text_model" : "hierarchical_model");
  if (docForm === "qa_model") {
    return chunkQaPairsForIndex(settings.qa_pairs ?? [], settings.settings_revision);
  }

  const rule = resolveDifyProcessRule(settings, docForm);
  const markdown = applyDifyPreProcessing(markdownInput, rule.preProcessingRules);
  const mode = docForm === "text_model" ? "general" : (settings.mode ?? "parent_child");
  const settingsRevision = positiveInt(settings.settings_revision, 1);
  const metadataBase = {
    doc_form: docForm,
    indexing_technique: settings.indexing_technique ?? "high_quality",
    process_rule_mode:
      settings.process_rule_mode ?? (docForm === "text_model" ? "custom" : "hierarchical"),
    parent_mode: rule.parentMode === "full_doc" ? "full_doc" : "paragraph",
    settings_revision: settingsRevision
  };

  if (mode === "general") {
    return chunkMarkdownByDifySplitter(markdown, {
      mode: rule.mode,
      fixedSeparator: normalizeChunkDelimiter(
        settings.parent_delimiter ?? rule.segmentation.separator
      ),
      maxCharacters: positiveInt(
        settings.parent_max_characters ?? rule.segmentation.maxTokens,
        rule.mode === "automatic"
          ? DIFY_AUTOMATIC_CHUNK_MAX_CHARACTERS
          : DEFAULT_CHUNK_MAX_CHARACTERS
      ),
      overlapCharacters: boundedOverlap(
        settings.chunk_overlap_characters ?? rule.segmentation.chunkOverlap,
        positiveInt(
          settings.parent_max_characters ?? rule.segmentation.maxTokens,
          rule.mode === "automatic"
            ? DIFY_AUTOMATIC_CHUNK_MAX_CHARACTERS
            : DEFAULT_CHUNK_MAX_CHARACTERS
        )
      )
    }).map((chunk) => ({
      ...chunk,
      chunk_type: "general",
      parent_ordinal: null,
      child_ordinal: null,
      settings_revision: settingsRevision,
      start_line: chunk.metadata.start_line,
      end_line: chunk.metadata.end_line,
      start_char: typeof chunk.metadata.start_char === "number" ? chunk.metadata.start_char : null,
      end_char: typeof chunk.metadata.end_char === "number" ? chunk.metadata.end_char : null,
      parent_local_id: null,
      metadata: {
        ...chunk.metadata,
        ...metadataBase,
        chunk_type: "general"
      }
    }));
  }

  return chunkMarkdownParentChild(markdown, {
    parentMode: settings.parent_mode ?? rule.parentMode,
    parentDelimiter: normalizeChunkDelimiter(
      settings.parent_delimiter ?? rule.segmentation.separator
    ),
    childDelimiter: normalizeChunkDelimiter(
      settings.child_delimiter ?? rule.subchunkSegmentation.separator
    ),
    parentMaxCharacters: positiveInt(
      settings.parent_max_characters ?? rule.segmentation.maxTokens,
      DEFAULT_PARENT_CHUNK_MAX_CHARACTERS
    ),
    parentOverlapCharacters: boundedOverlap(
      settings.chunk_overlap_characters ?? rule.segmentation.chunkOverlap,
      positiveInt(
        settings.parent_max_characters ?? rule.segmentation.maxTokens,
        DEFAULT_PARENT_CHUNK_MAX_CHARACTERS
      )
    ),
    childMaxCharacters: positiveInt(
      settings.child_max_characters ?? rule.subchunkSegmentation.maxTokens,
      DEFAULT_CHILD_CHUNK_MAX_CHARACTERS
    ),
    childOverlapCharacters: boundedOverlap(
      settings.child_overlap_characters ?? rule.subchunkSegmentation.chunkOverlap,
      positiveInt(
        settings.child_max_characters ?? rule.subchunkSegmentation.maxTokens,
        DEFAULT_CHILD_CHUNK_MAX_CHARACTERS
      )
    ),
    processRuleMode: rule.mode,
    settingsRevision,
    metadataBase
  });
}

export function chunkQaPairsForIndex(
  pairs: MarkdownQaPair[],
  settingsRevision = 1
): HierarchicalMarkdownChunk[] {
  const revision = positiveInt(settingsRevision, 1);
  return pairs
    .map((pair) => ({
      ...pair,
      question: String(pair.question ?? "").trim(),
      answer: String(pair.answer ?? "").trim()
    }))
    .filter((pair) => pair.question && pair.answer)
    .map((pair, index) => {
      const contentMarkdown = `**Q:** ${pair.question}\n\n**A:** ${pair.answer}`;
      const contentText = `${pair.question}\n${pair.answer}`;
      return {
        ordinal: index,
        heading_path: [],
        content_text: pair.question,
        content_markdown: contentMarkdown,
        token_count: estimateTokenCount(contentText),
        metadata: {
          start_line: null,
          end_line: null,
          chunk_type: "general",
          hit_type: "qa",
          qa_pair_id: pair.id ?? null,
          qa_question: pair.question,
          qa_answer: pair.answer,
          qa_source: pair.source ?? "manual",
          original_chunk_id: pair.source_chunk_id ?? null,
          source_chunk_id: pair.source_chunk_id ?? null,
          doc_form: "qa_model",
          settings_revision: revision
        },
        chunk_type: "general" as const,
        parent_ordinal: null,
        child_ordinal: null,
        settings_revision: revision,
        start_line: null,
        end_line: null,
        start_char: null,
        end_char: null,
        parent_local_id: null
      };
    });
}

type ResolvedDifyProcessRule = {
  mode: DifyProcessRuleMode;
  preProcessingRules: Array<{ id: string; enabled: boolean }>;
  segmentation: { separator: string; maxTokens: number; chunkOverlap: number };
  subchunkSegmentation: { separator: string; maxTokens: number; chunkOverlap: number };
  parentMode: MarkdownParentChunkMode;
};

function resolveDifyProcessRule(
  settings: MarkdownChunkingSettings,
  docForm: DifyDocForm
): ResolvedDifyProcessRule {
  const mode =
    settings.process_rule_mode ?? (docForm === "hierarchical_model" ? "hierarchical" : "custom");
  const rule =
    mode === "automatic"
      ? defaultDifyProcessRule(docForm)
      : toRecord(settings.process_rule ?? defaultDifyProcessRule(docForm));
  const parentMode =
    settings.parent_mode ??
    (rule.parent_mode === "full_doc" || rule.parent_mode === "full-doc" ? "full_doc" : "paragraph");
  return {
    mode,
    preProcessingRules: normalizePreProcessingRules(rule.pre_processing_rules),
    segmentation: normalizeDifySegmentation(rule.segmentation, {
      separator: "\n",
      maxTokens:
        mode === "automatic"
          ? DIFY_AUTOMATIC_CHUNK_MAX_CHARACTERS
          : docForm === "hierarchical_model"
            ? DEFAULT_PARENT_CHUNK_MAX_CHARACTERS
            : DEFAULT_CHUNK_MAX_CHARACTERS,
      chunkOverlap: mode === "automatic" ? DIFY_AUTOMATIC_CHUNK_OVERLAP_CHARACTERS : 50
    }),
    subchunkSegmentation: normalizeDifySegmentation(rule.subchunk_segmentation, {
      separator: "\n",
      maxTokens: DEFAULT_CHILD_CHUNK_MAX_CHARACTERS,
      chunkOverlap: DEFAULT_CHILD_CHUNK_OVERLAP_CHARACTERS
    }),
    parentMode
  };
}

function defaultDifyProcessRule(docForm: DifyDocForm): Record<string, unknown> {
  if (docForm === "hierarchical_model") {
    return {
      pre_processing_rules: [
        { id: "remove_extra_spaces", enabled: true },
        { id: "remove_urls_emails", enabled: false }
      ],
      segmentation: {
        separator: "\n",
        max_tokens: DEFAULT_PARENT_CHUNK_MAX_CHARACTERS,
        chunk_overlap: 50
      },
      parent_mode: "paragraph",
      subchunk_segmentation: {
        separator: "\n",
        max_tokens: DEFAULT_CHILD_CHUNK_MAX_CHARACTERS,
        chunk_overlap: DEFAULT_CHILD_CHUNK_OVERLAP_CHARACTERS
      }
    };
  }
  return {
    pre_processing_rules: [
      { id: "remove_extra_spaces", enabled: true },
      { id: "remove_urls_emails", enabled: false }
    ],
    segmentation: {
      separator: "\n",
      max_tokens: DIFY_AUTOMATIC_CHUNK_MAX_CHARACTERS,
      chunk_overlap: DIFY_AUTOMATIC_CHUNK_OVERLAP_CHARACTERS
    },
    parent_mode: "paragraph",
    subchunk_segmentation: {
      separator: "\n",
      max_tokens: DEFAULT_CHILD_CHUNK_MAX_CHARACTERS,
      chunk_overlap: DEFAULT_CHILD_CHUNK_OVERLAP_CHARACTERS
    }
  };
}

function normalizePreProcessingRules(value: unknown): Array<{ id: string; enabled: boolean }> {
  if (!Array.isArray(value)) {
    return [
      { id: "remove_extra_spaces", enabled: true },
      { id: "remove_urls_emails", enabled: false }
    ];
  }
  return value
    .map((item) => toRecord(item))
    .flatMap((item) => {
      const id = typeof item.id === "string" ? item.id : "";
      if (id !== "remove_extra_spaces" && id !== "remove_urls_emails") {
        return [];
      }
      return [{ id, enabled: item.enabled === true }];
    });
}

function normalizeDifySegmentation(
  value: unknown,
  fallback: { separator: string; maxTokens: number; chunkOverlap: number }
) {
  const record = toRecord(value);
  const separator =
    typeof record.separator === "string"
      ? record.separator
      : typeof record.delimiter === "string"
        ? record.delimiter
        : fallback.separator;
  return {
    separator,
    maxTokens: positiveInt(
      typeof record.max_tokens === "number" ? record.max_tokens : null,
      fallback.maxTokens
    ),
    chunkOverlap:
      typeof record.chunk_overlap === "number" && Number.isFinite(record.chunk_overlap)
        ? Math.max(0, Math.floor(record.chunk_overlap))
        : fallback.chunkOverlap
  };
}

function applyDifyPreProcessing(
  markdownInput: string,
  rules: Array<{ id: string; enabled: boolean }>
): string {
  let markdown = normalizeMarkdownSource(markdownInput).replace(
    /<\||\|>|[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\uFFFE]/g,
    (match) => (match === "<|" ? "<" : match === "|>" ? ">" : "")
  );
  if (rules.some((rule) => rule.id === "remove_urls_emails" && rule.enabled)) {
    const placeholders: Array<{ token: string; value: string }> = [];
    const protect = (value: string) => {
      const token = `__OPENKB_MARKDOWN_URL_${placeholders.length}__`;
      placeholders.push({ token, value });
      return token;
    };
    markdown = markdown
      .replace(/!\[[^\]]*]\(https?:\/\/[^)]+\)/gi, (match) => protect(match))
      .replace(/\[[^\]]*]\(https?:\/\/[^)]+\)/gi, (match) => protect(match))
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "")
      .replace(/https?:\/\/\S+/gi, "");
    for (const placeholder of placeholders) {
      markdown = markdown.replaceAll(placeholder.token, placeholder.value);
    }
  }
  if (rules.some((rule) => rule.id === "remove_extra_spaces" && rule.enabled)) {
    markdown = markdown
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[\t\f\r \u00a0\u1680\u180e\u2000-\u200a\u202f\u205f\u3000]{2,}/g, " ");
  }
  return normalizeMarkdownSource(markdown);
}

function chunkMarkdownParentChild(
  markdownInput: string,
  options: {
    parentMode: MarkdownParentChunkMode;
    parentDelimiter: string;
    childDelimiter: string;
    parentMaxCharacters: number;
    parentOverlapCharacters: number;
    childMaxCharacters: number;
    childOverlapCharacters: number;
    processRuleMode: DifyProcessRuleMode;
    settingsRevision: number;
    metadataBase: Record<string, unknown>;
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
      : chunkMarkdownByDifySplitter(markdown, {
          mode: options.processRuleMode,
          fixedSeparator: options.parentDelimiter,
          maxCharacters: options.parentMaxCharacters,
          overlapCharacters: options.parentOverlapCharacters
        });

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
        ...options.metadataBase,
        chunk_type: "parent",
        parent_ordinal: parentOrdinal,
        settings_revision: options.settingsRevision
      }
    });
    ordinal += 1;

    const childSegments = splitDifyText(parent.content_markdown, {
      mode: options.processRuleMode,
      fixedSeparator: options.childDelimiter,
      maxCharacters: options.childMaxCharacters,
      overlapCharacters: options.childOverlapCharacters
    })
      .map((chunk) => chunk.trim())
      .filter(Boolean);
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
          ...options.metadataBase,
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

function chunkMarkdownByDifySplitter(
  markdown: string,
  options: {
    mode: DifyProcessRuleMode;
    fixedSeparator: string;
    maxCharacters: number;
    overlapCharacters: number;
  }
): MarkdownChunk[] {
  const outline = extractMarkdownOutline(markdown);
  const chunks = splitDifyText(markdown, options)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  let cursor = 0;
  const mapped = chunks.map((contentMarkdown, ordinal) => {
    const range = findMarkdownRange(markdown, contentMarkdown, cursor);
    cursor = Math.max(cursor, range.endChar ?? cursor);
    const startLine =
      typeof range.startChar === "number" ? lineNumberAtChar(markdown, range.startChar) : 1;
    const endLine =
      typeof range.endChar === "number"
        ? lineNumberAtChar(markdown, Math.max(range.endChar - 1, range.startChar ?? 0))
        : startLine;
    const contentText = extractMarkdownPlainText(contentMarkdown);
    return {
      ordinal,
      heading_path: headingPathAtLine(outline, startLine),
      content_text: contentText,
      content_markdown: contentMarkdown,
      token_count: estimateTokenCount(contentText),
      metadata: {
        start_line: startLine,
        end_line: endLine,
        start_char: range.startChar,
        end_char: range.endChar
      }
    };
  });

  return mapped.length > 0
    ? mapped
    : [
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

function splitDifyText(
  text: string,
  options: {
    mode: DifyProcessRuleMode;
    fixedSeparator: string;
    maxCharacters: number;
    overlapCharacters: number;
  }
): string[] {
  const chunkSize =
    options.mode === "automatic" ? DIFY_AUTOMATIC_CHUNK_MAX_CHARACTERS : options.maxCharacters;
  const chunkOverlap =
    options.mode === "automatic"
      ? DIFY_AUTOMATIC_CHUNK_OVERLAP_CHARACTERS
      : boundedOverlap(options.overlapCharacters, chunkSize);

  if (options.mode === "automatic") {
    return recursiveDifySplit(text, DIFY_RECURSIVE_SEPARATORS, {
      chunkSize,
      chunkOverlap
    });
  }

  const fixedSeparator = decodeDifySeparator(options.fixedSeparator);
  const pieces = fixedSeparator ? splitOnInitialFixedDifySeparator(text, fixedSeparator) : [text];
  return pieces.flatMap((piece) =>
    codePointLength(piece) > chunkSize
      ? fixedRecursiveDifySplit(piece, DIFY_RECURSIVE_SEPARATORS, {
          chunkSize,
          chunkOverlap,
          preserveSpaceSeparator: fixedSeparator !== " "
        })
      : [piece]
  );
}

function recursiveDifySplit(
  text: string,
  separators: readonly string[],
  options: { chunkSize: number; chunkOverlap: number }
): string[] {
  let separator = separators[separators.length - 1] ?? "";
  let nextSeparators: readonly string[] = [];
  for (const [index, candidate] of separators.entries()) {
    if (candidate === "") {
      separator = candidate;
      break;
    }
    if (hasDifySeparator(text, candidate)) {
      separator = candidate;
      nextSeparators = separators.slice(index + 1);
      break;
    }
  }

  const splits = splitOnDifySeparator(text, separator).filter((split) =>
    separator === "\n" ? split !== "" : split !== "" && split !== "\n"
  );
  const finalChunks: string[] = [];
  let goodSplits: string[] = [];
  let goodSplitLengths: number[] = [];
  const splitLengths = splits.map(codePointLength);

  for (const [index, split] of splits.entries()) {
    const splitLength = splitLengths[index] ?? 0;
    if (splitLength < options.chunkSize) {
      goodSplits.push(split);
      goodSplitLengths.push(splitLength);
      continue;
    }

    if (goodSplits.length > 0) {
      finalChunks.push(...mergeDifySplits(goodSplits, "", goodSplitLengths, options));
      goodSplits = [];
      goodSplitLengths = [];
    }

    if (nextSeparators.length === 0) {
      finalChunks.push(split);
    } else {
      finalChunks.push(...recursiveDifySplit(split, nextSeparators, options));
    }
  }

  if (goodSplits.length > 0) {
    finalChunks.push(...mergeDifySplits(goodSplits, "", goodSplitLengths, options));
  }

  return finalChunks;
}

function fixedRecursiveDifySplit(
  text: string,
  separators: readonly string[],
  options: { chunkSize: number; chunkOverlap: number; preserveSpaceSeparator: boolean }
): string[] {
  let separator = separators[separators.length - 1] ?? "";
  let nextSeparators: readonly string[] = [];
  for (const [index, candidate] of separators.entries()) {
    if (candidate === "") {
      separator = candidate;
      break;
    }
    if (hasDifySeparator(text, candidate)) {
      separator = candidate;
      nextSeparators = separators.slice(index + 1);
      break;
    }
  }

  if (separator === "") {
    return splitDifyCharactersWithOverlap(text, options.chunkSize, options.chunkOverlap);
  }

  const splits = splitOnFixedDifySeparator(text, separator, options.preserveSpaceSeparator).filter(
    (split) => (separator === "\n" ? split !== "" : split !== "" && split !== "\n")
  );
  const finalChunks: string[] = [];
  let goodSplits: string[] = [];
  let goodSplitLengths: number[] = [];
  const splitLengths = splits.map(codePointLength);

  for (const [index, split] of splits.entries()) {
    const splitLength = splitLengths[index] ?? 0;
    if (splitLength < options.chunkSize) {
      goodSplits.push(split);
      goodSplitLengths.push(splitLength);
      continue;
    }

    if (goodSplits.length > 0) {
      finalChunks.push(...mergeDifySplits(goodSplits, "", goodSplitLengths, options));
      goodSplits = [];
      goodSplitLengths = [];
    }

    if (nextSeparators.length === 0) {
      finalChunks.push(split);
    } else {
      // Dify's FixedRecursiveCharacterTextSplitter falls back to the base recursive
      // splitter for oversized pieces, which preserves spaces and Markdown structure.
      finalChunks.push(...recursiveDifySplit(split, nextSeparators, options));
    }
  }

  if (goodSplits.length > 0) {
    finalChunks.push(...mergeDifySplits(goodSplits, "", goodSplitLengths, options));
  }

  return finalChunks;
}

function mergeDifySplits(
  splits: string[],
  separator: string,
  lengths: number[],
  options: { chunkSize: number; chunkOverlap: number }
): string[] {
  const separatorLength = codePointLength(separator);
  const docs: string[] = [];
  let currentDoc: string[] = [];
  let total = 0;

  for (const [index, split] of splits.entries()) {
    const splitLength = lengths[index] ?? codePointLength(split);
    if (total + splitLength + (currentDoc.length > 0 ? separatorLength : 0) > options.chunkSize) {
      if (currentDoc.length > 0) {
        const doc = joinDifyDocs(currentDoc, separator);
        if (doc !== null) {
          docs.push(doc);
        }
        while (
          total > options.chunkOverlap ||
          (total + splitLength + (currentDoc.length > 0 ? separatorLength : 0) >
            options.chunkSize &&
            total > 0)
        ) {
          total -=
            codePointLength(currentDoc[0] ?? "") + (currentDoc.length > 1 ? separatorLength : 0);
          currentDoc = currentDoc.slice(1);
        }
      }
    }
    currentDoc.push(split);
    total += splitLength + (currentDoc.length > 1 ? separatorLength : 0);
  }

  const doc = joinDifyDocs(currentDoc, separator);
  if (doc !== null) {
    docs.push(doc);
  }
  return docs;
}

function splitDifyCharactersWithOverlap(
  text: string,
  chunkSize: number,
  chunkOverlap: number
): string[] {
  const chunks: string[] = [];
  let currentPart = "";
  let currentLength = 0;
  let overlapPart = "";
  let overlapLength = 0;

  for (const character of Array.from(text)) {
    if (currentLength + 1 <= chunkSize - chunkOverlap) {
      currentPart += character;
      currentLength += 1;
    } else if (currentLength + 1 <= chunkSize) {
      currentPart += character;
      currentLength += 1;
      overlapPart += character;
      overlapLength += 1;
    } else {
      chunks.push(currentPart);
      currentPart = overlapPart + character;
      currentLength = overlapLength + 1;
      overlapPart = "";
      overlapLength = 0;
    }
  }

  if (currentPart) {
    chunks.push(currentPart);
  }
  return chunks;
}

function splitOnDifySeparator(text: string, separator: string): string[] {
  if (separator === "") {
    return Array.from(text);
  }
  const parts = text.split(separator);
  return parts.flatMap((part, index) =>
    index < parts.length - 1 ? [`${part}${separator}`] : [part]
  );
}

function splitOnFixedDifySeparator(
  text: string,
  separator: string,
  preserveSpaceSeparator: boolean
): string[] {
  if (separator === "") {
    return Array.from(text);
  }
  if (separator === " ") {
    return preserveSpaceSeparator ? splitOnDifySeparator(text, separator) : text.split(/ +/);
  }
  if (separator === ". ") {
    return splitOnEnglishPeriodSeparator(text);
  }
  const parts = text.split(separator);
  return parts.flatMap((part, index) =>
    index < parts.length - 1 ? [`${part}${separator}`] : [part]
  );
}

function splitOnInitialFixedDifySeparator(text: string, separator: string): string[] {
  if (separator === "") {
    return [text];
  }
  if (separator === " ") {
    return text.split(/ +/);
  }
  if (separator === ". ") {
    return splitOnEnglishPeriodSeparator(text).map((part, index, parts) =>
      index < parts.length - 1 && part.endsWith(separator) ? part.slice(0, -separator.length) : part
    );
  }
  return text.split(separator);
}

function splitOnEnglishPeriodSeparator(text: string): string[] {
  const separator = ". ";
  const parts: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length - 1; index += 1) {
    if (text[index] !== "." || text[index + 1] !== " ") {
      continue;
    }
    if (isOrderedListMarkerPeriod(text, index)) {
      continue;
    }
    parts.push(text.slice(start, index + separator.length));
    start = index + separator.length;
    index += 1;
  }
  parts.push(text.slice(start));
  return parts;
}

function isOrderedListMarkerPeriod(text: string, periodIndex: number): boolean {
  let lineStart = text.lastIndexOf("\n", periodIndex - 1);
  lineStart = lineStart === -1 ? 0 : lineStart + 1;
  const beforePeriod = text.slice(lineStart, periodIndex);
  return /^\s*\d+$/.test(beforePeriod);
}

function hasDifySeparator(text: string, separator: string): boolean {
  if (separator === ". ") {
    return /.\s/.test(text) && text.includes(separator);
  }
  return text.includes(separator);
}

function joinDifyDocs(docs: string[], separator: string): string | null {
  const text = docs.join(separator).trim();
  return text ? text : null;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function decodeDifySeparator(value: string): string {
  return value.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

function chunkMarkdownByDelimiterWithOverlap(
  markdown: string,
  options: {
    delimiter: string;
    maxCharacters: number;
    overlapCharacters: number;
  }
): MarkdownChunk[] {
  const outline = extractMarkdownOutline(markdown);
  const chunks = splitChildMarkdown(
    markdown,
    options.delimiter,
    options.maxCharacters,
    options.overlapCharacters
  );
  let cursor = 0;
  return chunks.map((contentMarkdown, ordinal) => {
    const range = findMarkdownRange(markdown, contentMarkdown, cursor);
    cursor = Math.max(cursor, range.endChar ?? cursor);
    const startLine =
      typeof range.startChar === "number" ? lineNumberAtChar(markdown, range.startChar) : 1;
    const endLine =
      typeof range.endChar === "number"
        ? lineNumberAtChar(markdown, Math.max(range.endChar - 1, range.startChar ?? 0))
        : startLine;
    const contentText = extractMarkdownPlainText(contentMarkdown);
    return {
      ordinal,
      heading_path: headingPathAtLine(outline, startLine),
      content_text: contentText,
      content_markdown: contentMarkdown,
      token_count: estimateTokenCount(contentText),
      metadata: {
        start_line: startLine,
        end_line: endLine,
        start_char: range.startChar,
        end_char: range.endChar
      }
    };
  });
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

function boundedOverlap(value: number | null | undefined, maxCharacters: number): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    return 0;
  }
  return Math.min(Number(value), Math.max(0, maxCharacters - 1));
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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
