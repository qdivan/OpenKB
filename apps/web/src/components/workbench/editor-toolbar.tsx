"use client";

import { DISABLED_EDITOR_INSERT_MENU_CAPABILITIES } from "@openkb/editor";
import {
  AlignLeft,
  AtSign,
  Baseline,
  Bold,
  Braces,
  CalendarDays,
  CheckSquare,
  ChevronDown,
  Code2,
  Ellipsis,
  Eraser,
  FileAudio,
  FileText,
  FileVideo,
  Highlighter,
  ImageIcon,
  Indent,
  Italic,
  Link2,
  List,
  ListOrdered,
  MapPinned,
  Minus,
  Music,
  PaintBucket,
  Paintbrush,
  Palette,
  Pilcrow,
  Plus,
  Quote,
  Redo2,
  Rows3,
  Search,
  Sigma,
  SquareFunction,
  Strikethrough,
  Table2,
  Type,
  Underline,
  Undo2,
  UnfoldVertical,
  Upload,
  WrapText
} from "lucide-react";
import type { ReactNode } from "react";

import { useI18n } from "@/lib/i18n-provider";

export type EditorToolbarAction =
  | "undo"
  | "redo"
  | "format_painter"
  | "clear_format"
  | "paragraph"
  | "heading_1"
  | "heading_2"
  | "heading_3"
  | "heading_4"
  | "heading_5"
  | "heading_6"
  | "bold"
  | "italic"
  | "strikethrough"
  | "underline"
  | "inline_code"
  | "font_color"
  | "background_color"
  | "align_left"
  | "align_center"
  | "align_right"
  | "align_justify"
  | "bullet_list"
  | "ordered_list"
  | "ordered_list_chinese"
  | "ordered_list_outline"
  | "indent"
  | "outdent"
  | "line_height"
  | "task_list"
  | "link"
  | "blockquote"
  | "divider"
  | "find_replace"
  | "insert_image"
  | "insert_table"
  | "insert_code_block"
  | "insert_date"
  | "insert_attachment";

export type EditorToolbarProps = {
  disabled?: boolean;
  onAction: (action: EditorToolbarAction) => void;
};

const disabledInsertIcon: Record<string, ReactNode> = {
  data_table: <Rows3 className="h-4 w-4" />,
  mermaid: <Braces className="h-4 w-4" />,
  formula: <Sigma className="h-4 w-4" />,
  plantuml: <SquareFunction className="h-4 w-4" />,
  collapsible_block: <UnfoldVertical className="h-4 w-4" />,
  highlight_block: <Highlighter className="h-4 w-4" />,
  mention: <AtSign className="h-4 w-4" />,
  calendar: <CalendarDays className="h-4 w-4" />,
  date: <CalendarDays className="h-4 w-4" />,
  encrypted_text: <FileText className="h-4 w-4" />,
  file_attachment: <Upload className="h-4 w-4" />,
  audio: <FileAudio className="h-4 w-4" />,
  video: <FileVideo className="h-4 w-4" />,
  bilibili: <FileVideo className="h-4 w-4" />,
  youku: <FileVideo className="h-4 w-4" />,
  figma: <Palette className="h-4 w-4" />,
  modao: <Palette className="h-4 w-4" />,
  amap: <MapPinned className="h-4 w-4" />,
  netease_music: <Music className="h-4 w-4" />
};

export function EditorToolbar({ disabled = false, onAction }: EditorToolbarProps) {
  const { t } = useI18n();
  const deferredStyleReason = t(
    "Requires a dedicated Milkdown style plugin before it can be saved."
  );

  return (
    <div className="openkb-editor-toolbar" aria-label={t("Editor toolbar")}>
      <div className="toolbar-primary">
        <ToolbarMenu
          disabled={disabled}
          icon={<Plus className="h-4 w-4" />}
          label={t("Insert")}
          items={[
            { label: t("Image"), icon: <ImageIcon className="h-4 w-4" />, action: "insert_image" },
            { label: t("Table"), icon: <Table2 className="h-4 w-4" />, action: "insert_table" },
            {
              label: t("Code block"),
              icon: <Code2 className="h-4 w-4" />,
              action: "insert_code_block"
            },
            { label: t("Quote"), icon: <Quote className="h-4 w-4" />, action: "blockquote" },
            { label: t("Divider"), icon: <Minus className="h-4 w-4" />, action: "divider" },
            {
              label: t("Task list"),
              icon: <CheckSquare className="h-4 w-4" />,
              action: "task_list"
            },
            { label: t("Date"), icon: <CalendarDays className="h-4 w-4" />, action: "insert_date" },
            {
              label: t("Attachment"),
              icon: <Upload className="h-4 w-4" />,
              action: "insert_attachment"
            },
            { kind: "separator" },
            ...DISABLED_EDITOR_INSERT_MENU_CAPABILITIES.map((capability) => ({
              label: t(capability.label),
              icon: disabledInsertIcon[capability.key] ?? <FileText className="h-4 w-4" />,
              disabled: true,
              reason: t(capability.reason ?? "")
            }))
          ]}
          onAction={onAction}
        />
        <ToolbarButton
          disabled={disabled}
          icon={<Undo2 className="h-4 w-4" />}
          label={t("Undo")}
          onClick={() => onAction("undo")}
        />
        <ToolbarButton
          disabled={disabled}
          icon={<Redo2 className="h-4 w-4" />}
          label={t("Redo")}
          onClick={() => onAction("redo")}
        />
        <select
          aria-label={t("Paragraph and heading")}
          className="toolbar-select w-28"
          defaultValue="paragraph"
          disabled={disabled}
          onChange={(event) => {
            onAction(event.target.value as EditorToolbarAction);
            event.target.value = "paragraph";
          }}
          title={t("Paragraph and heading")}
        >
          <option value="paragraph">{t("Paragraph")}</option>
          <option value="heading_1">{t("Heading 1")}</option>
          <option value="heading_2">{t("Heading 2")}</option>
          <option value="heading_3">{t("Heading 3")}</option>
          <option value="heading_4">{t("Heading 4")}</option>
          <option value="heading_5">{t("Heading 5")}</option>
          <option value="heading_6">{t("Heading 6")}</option>
        </select>
        <ToolbarButton
          disabled={disabled}
          icon={<Bold className="h-4 w-4" />}
          label={t("Bold")}
          onClick={() => onAction("bold")}
        />
        <ToolbarButton
          disabled={disabled}
          icon={<Italic className="h-4 w-4" />}
          label={t("Italic")}
          onClick={() => onAction("italic")}
        />
        <ToolbarButton
          disabled={disabled}
          icon={<Strikethrough className="h-4 w-4" />}
          label={t("Strikethrough")}
          onClick={() => onAction("strikethrough")}
        />
        <ToolbarButton
          disabled={disabled}
          icon={<List className="h-4 w-4" />}
          label={t("Bullet list")}
          onClick={() => onAction("bullet_list")}
        />
        <ToolbarMenu
          disabled={disabled}
          icon={<ListOrdered className="h-4 w-4" />}
          label={t("Ordered list")}
          items={[
            { label: "1. 2. 3.", action: "ordered_list" },
            {
              label: t("Chinese numbering"),
              action: "ordered_list_chinese",
              disabled: true,
              reason: t("Chinese list numbering is not part of V1 Markdown serialization.")
            },
            {
              label: "1 / 1.1 / 1.1.1",
              action: "ordered_list_outline",
              disabled: true,
              reason: t("Outline numbering needs a dedicated list style plugin.")
            }
          ]}
          onAction={onAction}
        />
        <ToolbarButton
          disabled={disabled}
          icon={<CheckSquare className="h-4 w-4" />}
          label={t("Task list")}
          onClick={() => onAction("task_list")}
        />
        <ToolbarButton
          disabled={disabled}
          icon={<Link2 className="h-4 w-4" />}
          label={t("Insert link")}
          onClick={() => onAction("link")}
        />
        <ToolbarButton
          disabled={disabled}
          icon={<Quote className="h-4 w-4" />}
          label={t("Quote")}
          onClick={() => onAction("blockquote")}
        />
        <ToolbarButton
          disabled={disabled}
          icon={<Minus className="h-4 w-4" />}
          label={t("Divider")}
          onClick={() => onAction("divider")}
        />
        <ToolbarButton
          disabled={disabled}
          icon={<Search className="h-4 w-4" />}
          label={t("Find and replace")}
          onClick={() => onAction("find_replace")}
        />
      </div>
      <ToolbarMenu
        align="right"
        disabled={disabled}
        icon={<Ellipsis className="h-4 w-4" />}
        label={t("More")}
        items={[
          { label: t("Inline code"), icon: <Code2 className="h-4 w-4" />, action: "inline_code" },
          {
            label: t("Clear basic formatting"),
            icon: <Eraser className="h-4 w-4" />,
            action: "clear_format"
          },
          { kind: "separator" },
          { label: t("Increase indent"), icon: <Indent className="h-4 w-4" />, action: "indent" },
          {
            label: t("Decrease indent"),
            icon: <Indent className="h-4 w-4 rotate-180" />,
            action: "outdent"
          },
          { kind: "separator" },
          {
            label: t("Format painter"),
            icon: <Paintbrush className="h-4 w-4" />,
            disabled: true,
            reason: t("Requires a style mark registry first.")
          },
          {
            label: t("Font size"),
            icon: <Type className="h-4 w-4" />,
            disabled: true,
            reason: t("Font size is not part of the V1 Markdown dialect.")
          },
          {
            label: t("Underline"),
            icon: <Underline className="h-4 w-4" />,
            disabled: true,
            reason: t("CommonMark/GFM has no native underline syntax.")
          },
          {
            label: t("Font color"),
            icon: <Baseline className="h-4 w-4" />,
            disabled: true,
            reason: deferredStyleReason
          },
          {
            label: t("Background color"),
            icon: <PaintBucket className="h-4 w-4" />,
            disabled: true,
            reason: deferredStyleReason
          },
          {
            label: t("Alignment"),
            icon: <AlignLeft className="h-4 w-4" />,
            disabled: true,
            reason: t("Alignment requires a serializable block attribute.")
          },
          {
            label: t("Line height"),
            icon: <WrapText className="h-4 w-4" />,
            disabled: true,
            reason: t("Line height is not part of the V1 Markdown dialect.")
          }
        ]}
        onAction={onAction}
      />
    </div>
  );
}

type ToolbarMenuItem =
  | {
      label: string;
      icon?: ReactNode;
      action?: EditorToolbarAction;
      disabled?: boolean;
      reason?: string;
      kind?: never;
    }
  | {
      kind: "separator";
      label?: never;
      icon?: never;
      action?: never;
      disabled?: never;
      reason?: never;
    };

function ToolbarButton({
  disabled,
  icon,
  label,
  onClick,
  reason
}: {
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  reason?: string;
}) {
  return (
    <button
      className="toolbar-button"
      disabled={disabled}
      onClick={onClick}
      title={reason ? `${label}: ${reason}` : label}
      type="button"
    >
      {icon}
    </button>
  );
}

function ToolbarMenu({
  align = "left",
  disabled,
  icon,
  items,
  label,
  onAction,
  reason
}: {
  align?: "left" | "right";
  disabled?: boolean;
  icon: ReactNode;
  items: ToolbarMenuItem[];
  label: string;
  onAction: (action: EditorToolbarAction) => void;
  reason?: string;
}) {
  return (
    <details className="toolbar-menu">
      <summary
        aria-disabled={disabled}
        aria-label={label}
        className={disabled ? "toolbar-button pointer-events-none opacity-50" : "toolbar-button"}
        title={reason ? `${label}: ${reason}` : label}
      >
        {icon}
        <ChevronDown className="h-3 w-3" />
      </summary>
      <div className={`toolbar-menu-panel ${align === "right" ? "toolbar-menu-panel-right" : ""}`}>
        {items.map((item, index) =>
          item.kind === "separator" ? (
            <div className="toolbar-menu-separator" key={`${label}:separator:${index}`} />
          ) : (
            <button
              className="toolbar-menu-item"
              disabled={item.disabled}
              key={`${label}:${item.label}`}
              onClick={() => {
                if (item.action) {
                  onAction(item.action);
                }
              }}
              title={item.reason ? `${item.label}: ${item.reason}` : item.label}
              type="button"
            >
              {item.icon ?? <Pilcrow className="h-4 w-4" />}
              <span>{item.label}</span>
            </button>
          )
        )}
      </div>
    </details>
  );
}
