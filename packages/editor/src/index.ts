export const EDITOR_PACKAGE_NAME = "@openkb/editor";

export type MilkdownPreset = "@milkdown/kit/preset/commonmark" | "@milkdown/kit/preset/gfm";

export type EditorFeatureKey =
  | "paragraph"
  | "heading"
  | "blockquote"
  | "bullet_list"
  | "ordered_list"
  | "code_block"
  | "inline_code"
  | "emphasis"
  | "strong"
  | "link"
  | "image"
  | "hard_break"
  | "table"
  | "task_list"
  | "strikethrough"
  | "autolink";

export type EditorFeature = {
  key: EditorFeatureKey;
  label: string;
  milkdownPlugin: MilkdownPreset;
  enabled: boolean;
  markdownSyntax: string[];
  supportsParse: boolean;
  supportsRender: boolean;
  supportsSerialize: boolean;
  supportsSearchExtraction: boolean;
};

export type MarkdownOutlineItem = {
  id: string;
  level: number;
  title: string;
  line: number;
};

export type MarkdownValidationIssue = {
  code:
    | "UNSUPPORTED_CALLOUT"
    | "UNSUPPORTED_MERMAID"
    | "UNSUPPORTED_LATEX_BLOCK"
    | "UNSUPPORTED_ASSET_URI";
  message: string;
  line: number;
};

export type MarkdownValidationResult = {
  ok: boolean;
  issues: MarkdownValidationIssue[];
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

export const EDITOR_FEATURES: EditorFeature[] = [
  feature("paragraph", "Paragraph", "@milkdown/kit/preset/commonmark", ["plain text"]),
  feature("heading", "Headings", "@milkdown/kit/preset/commonmark", ["#", "##", "###"]),
  feature("blockquote", "Blockquote", "@milkdown/kit/preset/commonmark", [">"]),
  feature("bullet_list", "Bullet list", "@milkdown/kit/preset/commonmark", ["-", "*"]),
  feature("ordered_list", "Ordered list", "@milkdown/kit/preset/commonmark", ["1."]),
  feature("code_block", "Code block", "@milkdown/kit/preset/commonmark", ["```"]),
  feature("inline_code", "Inline code", "@milkdown/kit/preset/commonmark", ["`code`"]),
  feature("emphasis", "Emphasis", "@milkdown/kit/preset/commonmark", ["*em*"]),
  feature("strong", "Strong", "@milkdown/kit/preset/commonmark", ["**strong**"]),
  feature("link", "Link", "@milkdown/kit/preset/commonmark", ["[text](url)"]),
  feature("image", "Image", "@milkdown/kit/preset/commonmark", ["![alt](url)"]),
  feature("hard_break", "Hard break", "@milkdown/kit/preset/commonmark", ["two trailing spaces"]),
  feature("table", "Table", "@milkdown/kit/preset/gfm", ["| header |"]),
  feature("task_list", "Task list", "@milkdown/kit/preset/gfm", ["- [ ] task"]),
  feature("strikethrough", "Strikethrough", "@milkdown/kit/preset/gfm", ["~~text~~"]),
  feature("autolink", "Autolink", "@milkdown/kit/preset/gfm", ["https://example.com"])
];

export const ENABLED_MILKDOWN_PRESETS = [
  "@milkdown/kit/preset/commonmark",
  "@milkdown/kit/preset/gfm"
] as const satisfies MilkdownPreset[];

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

export function validateMarkdownSource(markdown: string): MarkdownValidationResult {
  const issues: MarkdownValidationIssue[] = [];
  let inFence = false;
  let fenceLanguage = "";

  normalizeLineEndings(markdown)
    .split("\n")
    .forEach((line, index) => {
      const lineNumber = index + 1;
      const fence = /^\s*(```|~~~)\s*([A-Za-z0-9_-]+)?/.exec(line);
      if (fence) {
        inFence = !inFence;
        fenceLanguage = inFence ? (fence[2] ?? "").toLowerCase() : "";
        if (inFence && fenceLanguage === "mermaid") {
          issues.push({
            code: "UNSUPPORTED_MERMAID",
            message: "Mermaid blocks require a dedicated editor feature plugin.",
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
          message: "Callout containers are not enabled in the Phase 5 editor registry.",
          line: lineNumber
        });
      }
      if (/^\s*\$\$\s*$/.test(line)) {
        issues.push({
          code: "UNSUPPORTED_LATEX_BLOCK",
          message: "LaTeX blocks require a dedicated editor feature plugin.",
          line: lineNumber
        });
      }
      if (line.includes("asset://")) {
        issues.push({
          code: "UNSUPPORTED_ASSET_URI",
          message: "Asset URIs are deferred until the asset permission flow exists.",
          line: lineNumber
        });
      }
    });

  return { ok: issues.length === 0, issues };
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
  const markdown = normalizeLineEndings(input.markdown);

  return {
    ...input,
    markdown,
    markdown_hash: await createMarkdownHash(markdown)
  };
}

export function normalizeLineEndings(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n");
}

function feature(
  key: EditorFeatureKey,
  label: string,
  milkdownPlugin: MilkdownPreset,
  markdownSyntax: string[]
): EditorFeature {
  return {
    key,
    label,
    milkdownPlugin,
    enabled: true,
    markdownSyntax,
    supportsParse: true,
    supportsRender: true,
    supportsSerialize: true,
    supportsSearchExtraction: key === "heading" || key === "paragraph"
  };
}

function cleanInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .trim();
}

function slugifyHeading(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
