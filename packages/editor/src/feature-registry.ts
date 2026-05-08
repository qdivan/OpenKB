export const EDITOR_PACKAGE_NAME = "@openkb/editor";

export type MilkdownPreset = "@milkdown/kit/preset/commonmark" | "@milkdown/kit/preset/gfm";

export type EditorFeatureKey =
  | "paragraph"
  | "heading"
  | "blockquote"
  | "thematic_break"
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

export type EditorCapabilityStatus = "enabled" | "disabled";

export type EditorToolbarCapabilityKey =
  | "insert_menu"
  | "undo"
  | "redo"
  | "format_painter"
  | "clear_format"
  | "paragraph_heading"
  | "font_size"
  | "strong"
  | "emphasis"
  | "strikethrough"
  | "underline"
  | "more_text_styles"
  | "font_color"
  | "background_color"
  | "alignment"
  | "bullet_list"
  | "ordered_list"
  | "indent_list"
  | "outdent_list"
  | "line_height"
  | "task_list"
  | "link"
  | "blockquote"
  | "thematic_break"
  | "find_replace";

export type EditorInsertCapabilityKey =
  | "image"
  | "table"
  | "code_block"
  | "data_table"
  | "mermaid"
  | "formula"
  | "plantuml"
  | "thematic_break"
  | "blockquote"
  | "collapsible_block"
  | "highlight_block"
  | "mention"
  | "calendar"
  | "date"
  | "encrypted_text"
  | "file_attachment"
  | "audio"
  | "video"
  | "bilibili"
  | "youku"
  | "figma"
  | "modao"
  | "amap"
  | "netease_music"
  | "task_list";

export type EditorCapability = {
  key: EditorToolbarCapabilityKey | EditorInsertCapabilityKey;
  label: string;
  status: EditorCapabilityStatus;
  markdownNative: boolean;
  featureKey?: EditorFeatureKey;
  reason?: string;
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
  feature("thematic_break", "Thematic break", "@milkdown/kit/preset/commonmark", ["---"], "---"),
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

export const EDITOR_TOOLBAR_CAPABILITIES: EditorCapability[] = [
  enabledCapability("insert_menu", "Insert", "paragraph"),
  enabledCapability("undo", "Undo", "paragraph"),
  enabledCapability("redo", "Redo", "paragraph"),
  disabledCapability("format_painter", "Format painter", "Requires a style mark registry first."),
  enabledCapability("clear_format", "Clear basic formatting", "paragraph"),
  enabledCapability("paragraph_heading", "Paragraph and headings", "heading"),
  disabledCapability("font_size", "Font size", "Font size is not part of the V1 Markdown dialect."),
  enabledCapability("strong", "Bold", "strong"),
  enabledCapability("emphasis", "Italic", "emphasis"),
  enabledCapability("strikethrough", "Strikethrough", "strikethrough"),
  disabledCapability("underline", "Underline", "CommonMark/GFM has no native underline syntax."),
  enabledCapability("more_text_styles", "More text styles", "inline_code"),
  disabledCapability(
    "font_color",
    "Font color",
    "Color requires a dedicated Milkdown mark plugin."
  ),
  disabledCapability(
    "background_color",
    "Background color",
    "Background color requires a dedicated Milkdown mark plugin."
  ),
  disabledCapability(
    "alignment",
    "Alignment",
    "Alignment requires a serializable block attribute."
  ),
  enabledCapability("bullet_list", "Bullet list", "bullet_list"),
  enabledCapability("ordered_list", "Ordered list", "ordered_list"),
  enabledCapability("indent_list", "Increase list indent", "bullet_list"),
  enabledCapability("outdent_list", "Decrease list indent", "bullet_list"),
  disabledCapability(
    "line_height",
    "Line height",
    "Line height is not part of the V1 Markdown dialect."
  ),
  enabledCapability("task_list", "Task list", "task_list"),
  enabledCapability("link", "Link", "link"),
  enabledCapability("blockquote", "Blockquote", "blockquote"),
  enabledCapability("thematic_break", "Divider", "thematic_break"),
  enabledCapability("find_replace", "Find and replace", "paragraph")
];

export const EDITOR_INSERT_MENU_CAPABILITIES: EditorCapability[] = [
  enabledCapability("image", "Image", "image"),
  enabledCapability("table", "Table", "table"),
  enabledCapability("code_block", "Code block", "code_block"),
  disabledCapability("data_table", "Data table", "Structured table documents are outside v0.x."),
  disabledCapability("mermaid", "Mermaid", "Mermaid requires a dedicated Milkdown plugin."),
  disabledCapability("formula", "Formula", "Formula requires a dedicated Milkdown plugin."),
  disabledCapability("plantuml", "PlantUML", "PlantUML requires a dedicated Milkdown plugin."),
  enabledCapability("thematic_break", "Divider", "thematic_break"),
  enabledCapability("blockquote", "Blockquote", "blockquote"),
  disabledCapability("collapsible_block", "Collapsible block", "Requires a custom block plugin."),
  disabledCapability("highlight_block", "Highlight block", "Requires a custom block plugin."),
  disabledCapability("mention", "Mention", "Mentions need user resolution and a node plugin."),
  disabledCapability("calendar", "Calendar", "Calendar embed is not in the V1 dialect."),
  enabledCapability("date", "Date", "paragraph"),
  disabledCapability(
    "encrypted_text",
    "Encrypted text",
    "Requires encryption and access policy design."
  ),
  enabledCapability("file_attachment", "File attachment", "link"),
  disabledCapability("audio", "Audio", "Media embeds require asset card plugins."),
  disabledCapability("video", "Video", "Media embeds require asset card plugins."),
  disabledCapability(
    "bilibili",
    "Bilibili video",
    "Third-party embeds require a safe embed plugin."
  ),
  disabledCapability("youku", "Youku video", "Third-party embeds require a safe embed plugin."),
  disabledCapability("figma", "Figma", "Third-party embeds require a safe embed plugin."),
  disabledCapability("modao", "Modao", "Third-party embeds require a safe embed plugin."),
  disabledCapability("amap", "Amap", "Third-party embeds require a safe embed plugin."),
  disabledCapability(
    "netease_music",
    "NetEase Music",
    "Third-party embeds require a safe embed plugin."
  ),
  enabledCapability("task_list", "Task list", "task_list")
];

export const ENABLED_EDITOR_FEATURES = EDITOR_FEATURES.filter((feature) => feature.enabled);

export const ENABLED_MILKDOWN_PRESETS = Array.from(
  new Set(ENABLED_EDITOR_FEATURES.map((feature) => feature.milkdownPlugin))
) as MilkdownPreset[];

export const ENABLED_EDITOR_FEATURE_KEYS = ENABLED_EDITOR_FEATURES.map(
  (feature) => feature.key
) as EditorFeatureKey[];

export const ENABLED_EDITOR_TOOLBAR_CAPABILITIES = EDITOR_TOOLBAR_CAPABILITIES.filter(
  (capability) => capability.status === "enabled"
);

export const DISABLED_EDITOR_TOOLBAR_CAPABILITIES = EDITOR_TOOLBAR_CAPABILITIES.filter(
  (capability) => capability.status === "disabled"
);

export const ENABLED_EDITOR_INSERT_MENU_CAPABILITIES = EDITOR_INSERT_MENU_CAPABILITIES.filter(
  (capability) => capability.status === "enabled"
);

export const DISABLED_EDITOR_INSERT_MENU_CAPABILITIES = EDITOR_INSERT_MENU_CAPABILITIES.filter(
  (capability) => capability.status === "disabled"
);

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

export function getToolbarCapability(key: EditorToolbarCapabilityKey): EditorCapability {
  return getCapability(EDITOR_TOOLBAR_CAPABILITIES, key);
}

export function getInsertMenuCapability(key: EditorInsertCapabilityKey): EditorCapability {
  return getCapability(EDITOR_INSERT_MENU_CAPABILITIES, key);
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

function enabledCapability(
  key: EditorToolbarCapabilityKey | EditorInsertCapabilityKey,
  label: string,
  featureKey: EditorFeatureKey
): EditorCapability {
  return {
    key,
    label,
    status: "enabled",
    markdownNative: true,
    featureKey
  };
}

function disabledCapability(
  key: EditorToolbarCapabilityKey | EditorInsertCapabilityKey,
  label: string,
  reason: string
): EditorCapability {
  return {
    key,
    label,
    status: "disabled",
    markdownNative: false,
    reason
  };
}

function getCapability<T extends EditorCapability>(capabilities: readonly T[], key: T["key"]): T {
  const capability = capabilities.find((item) => item.key === key);
  if (!capability) {
    throw new Error(`Unknown editor capability: ${key}`);
  }
  return capability;
}
