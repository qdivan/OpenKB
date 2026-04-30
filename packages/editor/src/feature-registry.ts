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
  supportsSourceValidation: boolean;
  supportsImportValidation: boolean;
  roundTripMarkdown: string;
};

export const EDITOR_FEATURES: EditorFeature[] = [
  feature(
    "paragraph",
    "Paragraph",
    "@milkdown/kit/preset/commonmark",
    ["plain text"],
    "Plain text"
  ),
  feature("heading", "Headings", "@milkdown/kit/preset/commonmark", ["#", "##", "###"], "# Title"),
  feature("blockquote", "Blockquote", "@milkdown/kit/preset/commonmark", [">"], "> Quote"),
  feature("bullet_list", "Bullet list", "@milkdown/kit/preset/commonmark", ["-", "*"], "- Item"),
  feature("ordered_list", "Ordered list", "@milkdown/kit/preset/commonmark", ["1."], "1. Item"),
  feature(
    "code_block",
    "Code block",
    "@milkdown/kit/preset/commonmark",
    ["```"],
    "```ts\nconst ok = true;\n```"
  ),
  feature("inline_code", "Inline code", "@milkdown/kit/preset/commonmark", ["`code`"], "`code`"),
  feature("emphasis", "Emphasis", "@milkdown/kit/preset/commonmark", ["*em*"], "*emphasis*"),
  feature("strong", "Strong", "@milkdown/kit/preset/commonmark", ["**strong**"], "**strong**"),
  feature(
    "link",
    "Link",
    "@milkdown/kit/preset/commonmark",
    ["[text](url)", "openkb://document/{id}"],
    "[OpenKB](https://openkb.local)"
  ),
  feature(
    "image",
    "Image",
    "@milkdown/kit/preset/commonmark",
    ["![alt](url)", "asset://{asset_id}"],
    "![Diagram](asset://asset_123)"
  ),
  feature(
    "hard_break",
    "Hard break",
    "@milkdown/kit/preset/commonmark",
    ["two trailing spaces"],
    "Line one  \nLine two"
  ),
  feature(
    "table",
    "Table",
    "@milkdown/kit/preset/gfm",
    ["| header |"],
    "| Name | Value |\n| --- | --- |\n| OpenKB | Markdown |"
  ),
  feature(
    "task_list",
    "Task list",
    "@milkdown/kit/preset/gfm",
    ["- [ ] task"],
    "- [ ] Todo\n- [x] Done"
  ),
  feature(
    "strikethrough",
    "Strikethrough",
    "@milkdown/kit/preset/gfm",
    ["~~text~~"],
    "~~removed~~"
  ),
  feature(
    "autolink",
    "Autolink",
    "@milkdown/kit/preset/gfm",
    ["https://example.com"],
    "https://openkb.local"
  )
];

export const ENABLED_EDITOR_FEATURES = EDITOR_FEATURES.filter((feature) => feature.enabled);

export const ENABLED_MILKDOWN_PRESETS = Array.from(
  new Set(ENABLED_EDITOR_FEATURES.map((feature) => feature.milkdownPlugin))
) as MilkdownPreset[];

export const ENABLED_EDITOR_FEATURE_KEYS = ENABLED_EDITOR_FEATURES.map(
  (feature) => feature.key
) as EditorFeatureKey[];

export function getEditorFeature(key: EditorFeatureKey): EditorFeature {
  const feature = EDITOR_FEATURES.find((item) => item.key === key);
  if (!feature) {
    throw new Error(`Unknown editor feature: ${key}`);
  }
  return feature;
}

export function isEditorFeatureEnabled(key: EditorFeatureKey): boolean {
  return getEditorFeature(key).enabled;
}

export function getSearchExtractableFeatures(): EditorFeature[] {
  return ENABLED_EDITOR_FEATURES.filter((feature) => feature.supportsSearchExtraction);
}

export function getImportValidationFeatures(): EditorFeature[] {
  return ENABLED_EDITOR_FEATURES.filter((feature) => feature.supportsImportValidation);
}

export type MarkdownRoundTripFixture = {
  featureKey: EditorFeatureKey;
  markdown: string;
};

export function getEnabledFeatureRoundTripFixtures(): MarkdownRoundTripFixture[] {
  return ENABLED_EDITOR_FEATURES.map((feature) => ({
    featureKey: feature.key,
    markdown: feature.roundTripMarkdown
  }));
}

function feature(
  key: EditorFeatureKey,
  label: string,
  milkdownPlugin: MilkdownPreset,
  markdownSyntax: string[],
  roundTripMarkdown: string
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
    supportsSearchExtraction:
      key === "paragraph" ||
      key === "heading" ||
      key === "blockquote" ||
      key === "bullet_list" ||
      key === "ordered_list" ||
      key === "task_list" ||
      key === "table" ||
      key === "link" ||
      key === "image",
    supportsSourceValidation: true,
    supportsImportValidation: true,
    roundTripMarkdown
  };
}
