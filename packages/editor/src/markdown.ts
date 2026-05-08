import { ENABLED_EDITOR_FEATURES, type EditorFeatureKey } from "./feature-registry";

export const MARKDOWN_DIALECT_ERROR = "MARKDOWN_DIALECT_ERROR";

export type MarkdownOutlineItem = {
  id: string;
  level: number;
  title: string;
  line: number;
};

export type MarkdownValidationIssueCode =
  | "UNSUPPORTED_CALLOUT"
  | "UNSUPPORTED_MERMAID"
  | "UNSUPPORTED_LATEX_BLOCK"
  | "UNCLOSED_CODE_FENCE"
  | "INVALID_ASSET_URI"
  | "INVALID_INTERNAL_LINK_URI"
  | "UNSAFE_LINK_URI";

export type MarkdownValidationIssue = {
  code: MarkdownValidationIssueCode;
  message: string;
  line: number;
};

export type MarkdownValidationResult = {
  ok: boolean;
  issues: MarkdownValidationIssue[];
};

export type MarkdownInternalLinkReference = {
  type: "internal_document";
  documentId: string;
  label: string;
  line: number;
  rawUrl: string;
};

export type MarkdownAssetReference = {
  type: "asset";
  assetId: string;
  alt: string;
  line: number;
  rawUrl: string;
};

export type MarkdownExternalLinkReference = {
  type: "external";
  url: string;
  label: string;
  line: number;
};

export type MarkdownReferenceExtraction = {
  internalLinks: MarkdownInternalLinkReference[];
  assetReferences: MarkdownAssetReference[];
  externalLinks: MarkdownExternalLinkReference[];
};

export type EditorSavePayloadInput = {
  document_id: string;
  base_version_id: string | null;
  title: string;
  markdown: string;
};

export type EditorSavePayload = EditorSavePayloadInput & {
  markdown_hash: string;
};

export type MarkdownReplaceOptions = {
  matchCase?: boolean;
  replaceAll?: boolean;
};

export type MarkdownReplaceResult = {
  markdown: string;
  count: number;
};

export type MarkdownClearFormattingResult = {
  markdown: string;
  changed: boolean;
};

export type MilkdownAssetPlaceholder = {
  assetId: string;
  assetUrl: string;
  placeholderUrl: string;
};

export type MilkdownMarkdownPreparation = {
  markdown: string;
  assetPlaceholders: MilkdownAssetPlaceholder[];
};

const LINK_DESTINATION_PATTERN = /(!?)\[([^\]\n]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
const ASSET_IMAGE_PATTERN = /!\[([^\]\n]*)\]\((asset:\/\/[A-Za-z0-9][A-Za-z0-9_-]{0,127})\)/g;
const SAFE_URI_PATTERN =
  /^(https?:\/\/|mailto:|\/|#|\.\/|\.\.\/|openkb:\/\/document\/|asset:\/\/)/i;
const ASSET_URI_PATTERN = /^asset:\/\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/;
const ASSET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const INTERNAL_DOCUMENT_URI_PATTERN = /^openkb:\/\/document\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/;

export function normalizeMarkdownSource(markdown: string): string {
  return normalizeLineEndings(markdown);
}

export function extractMarkdownOutline(markdown: string): MarkdownOutlineItem[] {
  const usedIds = new Map<string, number>();
  const outline: MarkdownOutlineItem[] = [];
  let inFence = false;

  normalizeLineEndings(markdown)
    .split("\n")
    .forEach((line, index) => {
      if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) {
        inFence = !inFence;
        return;
      }
      if (inFence) {
        return;
      }

      const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (!match) {
        return;
      }

      const marker = match[1] ?? "";
      const title = cleanInlineMarkdown(match[2] ?? "");
      const baseId = slugifyHeading(title) || `heading-${index + 1}`;
      const count = usedIds.get(baseId) ?? 0;
      usedIds.set(baseId, count + 1);

      outline.push({
        id: count === 0 ? baseId : `${baseId}-${count + 1}`,
        level: marker.length,
        title,
        line: index + 1
      });
    });

  return outline;
}

export function extractMarkdownPlainText(markdown: string): string {
  const parts: string[] = [];
  let inFence = false;

  for (const line of normalizeLineEndings(markdown).split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }

    const text = cleanInlineMarkdown(
      line
        .replace(/^#{1,6}\s+/, "")
        .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, "")
        .replace(/^\s*[-*+]\s+/, "")
        .replace(/^\s*\d+\.\s+/, "")
        .replace(/^\s*>\s?/, "")
        .replace(/\|/g, " ")
    ).trim();

    if (text || inFence) {
      parts.push(text);
    }
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function extractMarkdownReferences(markdown: string): MarkdownReferenceExtraction {
  const internalLinks: MarkdownInternalLinkReference[] = [];
  const assetReferences: MarkdownAssetReference[] = [];
  const externalLinks: MarkdownExternalLinkReference[] = [];
  let inFence = false;

  normalizeLineEndings(markdown)
    .split("\n")
    .forEach((line, index) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return;
      }
      if (inFence) {
        return;
      }

      for (const link of scanMarkdownLinks(line)) {
        const lineNumber = index + 1;
        const asset = ASSET_URI_PATTERN.exec(link.url);
        if (asset) {
          assetReferences.push({
            type: "asset",
            assetId: asset[1] ?? "",
            alt: link.label,
            line: lineNumber,
            rawUrl: link.url
          });
          continue;
        }

        const internal = INTERNAL_DOCUMENT_URI_PATTERN.exec(link.url);
        if (internal) {
          internalLinks.push({
            type: "internal_document",
            documentId: internal[1] ?? "",
            label: link.label,
            line: lineNumber,
            rawUrl: link.url
          });
          continue;
        }

        if (/^https?:\/\//i.test(link.url) || /^mailto:/i.test(link.url)) {
          externalLinks.push({
            type: "external",
            url: link.url,
            label: link.label,
            line: lineNumber
          });
        }
      }
    });

  return { internalLinks, assetReferences, externalLinks };
}

export function prepareMarkdownForMilkdown(markdown: string): MilkdownMarkdownPreparation {
  const assetPlaceholders: MilkdownAssetPlaceholder[] = [];
  const prepared = normalizeLineEndings(markdown).replace(
    ASSET_IMAGE_PATTERN,
    (match, alt: string, assetUrl: string) => {
      const asset = ASSET_URI_PATTERN.exec(assetUrl);
      const assetId = asset?.[1] ?? "";
      if (!assetId) {
        return match;
      }

      const placeholderUrl = createAssetPlaceholderDataUrl(assetId, alt);
      assetPlaceholders.push({ assetId, assetUrl, placeholderUrl });
      return `![${alt}](${placeholderUrl})`;
    }
  );

  return { markdown: prepared, assetPlaceholders };
}

export function restoreMarkdownFromMilkdown(
  markdown: string,
  preparation: MilkdownMarkdownPreparation
): string {
  let restored = markdown;
  for (const placeholder of preparation.assetPlaceholders) {
    restored = restored.split(placeholder.placeholderUrl).join(placeholder.assetUrl);
  }
  return restored;
}

export function createAssetImageMarkdown(assetId: string, alt = "Image"): string {
  const normalizedAssetId = assetId.trim();
  if (!ASSET_ID_PATTERN.test(normalizedAssetId)) {
    throw new Error("Asset image markdown requires a stable asset id.");
  }

  const safeAlt =
    alt
      .replace(/[\r\n[\]]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Image";
  return `![${safeAlt}](asset://${normalizedAssetId})`;
}

export function createAssetLinkMarkdown(assetId: string, filename = "Attachment"): string {
  const normalizedAssetId = assetId.trim();
  if (!ASSET_ID_PATTERN.test(normalizedAssetId)) {
    throw new Error("Asset link markdown requires a stable asset id.");
  }

  const safeLabel =
    filename
      .replace(/[\r\n[\]]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Attachment";
  return `[${safeLabel}](asset://${normalizedAssetId})`;
}

export function createMarkdownDateText(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function clearBasicMarkdownFormatting(markdown: string): MarkdownClearFormattingResult {
  const source = normalizeLineEndings(markdown);
  const cleared = source
    .replace(/!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g, "$1")
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/~~([^~\n]+)~~/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1");

  return { markdown: cleared, changed: cleared !== source };
}

export function replaceMarkdownText(
  markdown: string,
  find: string,
  replacement: string,
  options: MarkdownReplaceOptions = {}
): MarkdownReplaceResult {
  if (!find) {
    return { markdown, count: 0 };
  }

  const source = normalizeLineEndings(markdown);
  const flags = options.matchCase ? "g" : "gi";
  const pattern = new RegExp(
    escapeRegExp(find),
    options.replaceAll === false ? flags.replace("g", "") : flags
  );
  let count = 0;
  const nextMarkdown = source.replace(pattern, () => {
    count += 1;
    return replacement;
  });

  return { markdown: nextMarkdown, count };
}

export function validateMarkdownSource(markdown: string): MarkdownValidationResult {
  const issues: MarkdownValidationIssue[] = [];
  let inFence = false;
  let fenceLanguage = "";
  let fenceStartLine = 0;

  normalizeLineEndings(markdown)
    .split("\n")
    .forEach((line, index) => {
      const lineNumber = index + 1;
      const fence = /^\s*(```|~~~)\s*([A-Za-z0-9_-]+)?/.exec(line);
      if (fence) {
        inFence = !inFence;
        fenceStartLine = inFence ? lineNumber : 0;
        fenceLanguage = inFence ? (fence[2] ?? "").toLowerCase() : "";
        if (inFence && fenceLanguage === "mermaid") {
          issues.push({
            code: "UNSUPPORTED_MERMAID",
            message: "Mermaid blocks require a dedicated Milkdown feature plugin.",
            line: lineNumber
          });
        }
        return;
      }

      if (inFence) {
        return;
      }

      if (/^\s*:::+/.test(line)) {
        issues.push({
          code: "UNSUPPORTED_CALLOUT",
          message: "Callout containers are not enabled in the editor feature registry.",
          line: lineNumber
        });
      }
      if (/^\s*\$\$\s*$/.test(line)) {
        issues.push({
          code: "UNSUPPORTED_LATEX_BLOCK",
          message: "LaTeX blocks require a dedicated Milkdown feature plugin.",
          line: lineNumber
        });
      }

      for (const link of scanMarkdownLinks(line)) {
        validateMarkdownLinkDestination(link.url, lineNumber, issues);
      }
    });

  if (inFence) {
    issues.push({
      code: "UNCLOSED_CODE_FENCE",
      message: "Code fence is not closed.",
      line: fenceStartLine
    });
  }

  return { ok: issues.length === 0, issues };
}

export function validateMarkdownForImport(markdown: string): MarkdownValidationResult {
  return validateMarkdownSource(markdown);
}

export async function createMarkdownHash(markdown: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto SHA-256 support is required to hash markdown.");
  }

  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(markdown));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createEditorSavePayload(
  input: EditorSavePayloadInput
): Promise<EditorSavePayload> {
  const markdown = normalizeMarkdownSource(input.markdown);

  return {
    ...input,
    markdown,
    markdown_hash: await createMarkdownHash(markdown)
  };
}

export function normalizeLineEndings(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n");
}

export function getSearchExtractableFeatureKeys(): EditorFeatureKey[] {
  return ENABLED_EDITOR_FEATURES.filter((feature) => feature.supportsSearchExtraction).map(
    (feature) => feature.key
  );
}

function validateMarkdownLinkDestination(
  url: string,
  line: number,
  issues: MarkdownValidationIssue[]
) {
  if (url.startsWith("asset://")) {
    if (!ASSET_URI_PATTERN.test(url)) {
      issues.push({
        code: "INVALID_ASSET_URI",
        message: "Asset links must use asset://{asset_id}.",
        line
      });
    }
    return;
  }

  if (url.startsWith("openkb://")) {
    if (!INTERNAL_DOCUMENT_URI_PATTERN.test(url)) {
      issues.push({
        code: "INVALID_INTERNAL_LINK_URI",
        message: "Internal links must use openkb://document/{document_id}.",
        line
      });
    }
    return;
  }

  if (!SAFE_URI_PATTERN.test(url)) {
    issues.push({
      code: "UNSAFE_LINK_URI",
      message: "Markdown links must use http, https, mailto, relative, asset, or OpenKB URLs.",
      line
    });
  }
}

function scanMarkdownLinks(line: string): Array<{ image: boolean; label: string; url: string }> {
  const links: Array<{ image: boolean; label: string; url: string }> = [];
  LINK_DESTINATION_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = LINK_DESTINATION_PATTERN.exec(line))) {
    links.push({
      image: match[1] === "!",
      label: match[2] ?? "",
      url: match[3] ?? ""
    });
  }

  return links;
}

function cleanInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .trim();
}

function createAssetPlaceholderDataUrl(assetId: string, alt: string): string {
  const title = escapeXml(alt.trim() || "OpenKB asset");
  const subtitle = escapeXml(assetId);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="240" viewBox="0 0 960 240"><rect width="960" height="240" rx="12" fill="#f4f4f5"/><rect x="24" y="24" width="912" height="192" rx="10" fill="#ffffff" stroke="#d4d4d8"/><text x="48" y="104" font-family="Arial, sans-serif" font-size="28" font-weight="600" fill="#18181b">${title}</text><text x="48" y="150" font-family="Arial, sans-serif" font-size="18" fill="#71717a">asset://${subtitle}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugifyHeading(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
