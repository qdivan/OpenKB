"use client";

import {
  type CmdKey,
  defaultValueCtx,
  Editor,
  editorViewCtx,
  editorViewOptionsCtx,
  rootCtx
} from "@milkdown/kit/core";
import { history, redoCommand, undoCommand } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import {
  commonmark,
  createCodeBlockCommand,
  insertHrCommand,
  insertImageCommand,
  liftListItemCommand,
  sinkListItemCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand
} from "@milkdown/kit/preset/commonmark";
import { gfm, insertTableCommand, toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import { callCommand, insert } from "@milkdown/kit/utils";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { ENABLED_MILKDOWN_PRESETS, type MilkdownPreset } from "@openkb/editor";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export type MilkdownEditorProps = {
  markdown: string;
  editable: boolean;
  onChange: (markdown: string) => void;
};

export type MilkdownCommandBridge = {
  focus: () => boolean;
  undo: () => boolean;
  redo: () => boolean;
  paragraph: () => boolean;
  heading: (level: 1 | 2 | 3 | 4 | 5 | 6) => boolean;
  bold: () => boolean;
  italic: () => boolean;
  strikethrough: () => boolean;
  inlineCode: () => boolean;
  link: (href: string, title?: string) => boolean;
  blockquote: () => boolean;
  divider: () => boolean;
  codeBlock: () => boolean;
  bulletList: () => boolean;
  orderedList: () => boolean;
  indent: () => boolean;
  outdent: () => boolean;
  taskList: () => boolean;
  table: () => boolean;
  image: (src: string, alt?: string) => boolean;
  insertMarkdown: (markdown: string, inline?: boolean) => boolean;
};

const milkdownPresetPlugins = {
  "@milkdown/kit/preset/commonmark": commonmark,
  "@milkdown/kit/preset/gfm": gfm
} satisfies Record<MilkdownPreset, typeof commonmark>;

type MilkdownEditorInstance = ReturnType<typeof Editor.make> | undefined;

export const MilkdownEditor = forwardRef<MilkdownCommandBridge, MilkdownEditorProps>(
  function MilkdownEditor(props, ref) {
    return (
      <MilkdownProvider>
        <MilkdownEditorInner ref={ref} {...props} />
      </MilkdownProvider>
    );
  }
);

const MilkdownEditorInner = forwardRef<MilkdownCommandBridge, MilkdownEditorProps>(
  function MilkdownEditorInner({ markdown, editable, onChange }, ref) {
    const onChangeRef = useRef(onChange);
    const initialMarkdownRef = useRef(markdown);

    useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);

    const editor = useEditor(
      (root) => {
        const nextEditor = Editor.make().config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, initialMarkdownRef.current);
          ctx.set(editorViewOptionsCtx, {
            editable: () => editable,
            attributes: {
              class: editable ? "openkb-milkdown-editor" : "openkb-milkdown-reader"
            }
          });
          ctx.get(listenerCtx).markdownUpdated((_, nextMarkdown, previousMarkdown) => {
            if (nextMarkdown !== previousMarkdown) {
              onChangeRef.current(nextMarkdown);
            }
          });
        });

        for (const preset of ENABLED_MILKDOWN_PRESETS) {
          nextEditor.use(milkdownPresetPlugins[preset]);
        }

        return nextEditor.use(history).use(listener);
      },
      [editable]
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: () =>
          runEditorAction(editor.get(), (ctx) => {
            ctx.get(editorViewCtx).focus();
            return true;
          }),
        undo: () => callMilkdownCommand(editor.get(), undoCommand.key),
        redo: () => callMilkdownCommand(editor.get(), redoCommand.key),
        paragraph: () => callMilkdownCommand(editor.get(), turnIntoTextCommand.key),
        heading: (level) => callMilkdownCommand(editor.get(), wrapInHeadingCommand.key, level),
        bold: () => callMilkdownCommand(editor.get(), toggleStrongCommand.key),
        italic: () => callMilkdownCommand(editor.get(), toggleEmphasisCommand.key),
        strikethrough: () => callMilkdownCommand(editor.get(), toggleStrikethroughCommand.key),
        inlineCode: () => callMilkdownCommand(editor.get(), toggleInlineCodeCommand.key),
        link: (href, title) =>
          callMilkdownCommand(editor.get(), toggleLinkCommand.key, {
            href,
            title
          }),
        blockquote: () => callMilkdownCommand(editor.get(), wrapInBlockquoteCommand.key),
        divider: () => callMilkdownCommand(editor.get(), insertHrCommand.key),
        codeBlock: () => callMilkdownCommand(editor.get(), createCodeBlockCommand.key),
        bulletList: () => callMilkdownCommand(editor.get(), wrapInBulletListCommand.key),
        orderedList: () => callMilkdownCommand(editor.get(), wrapInOrderedListCommand.key),
        indent: () => callMilkdownCommand(editor.get(), sinkListItemCommand.key),
        outdent: () => callMilkdownCommand(editor.get(), liftListItemCommand.key),
        taskList: () => insertMarkdown(editor.get(), "- [ ] Task\n"),
        table: () => callMilkdownCommand(editor.get(), insertTableCommand.key, { row: 3, col: 3 }),
        image: (src, alt) =>
          callMilkdownCommand(editor.get(), insertImageCommand.key, {
            src,
            alt
          }),
        insertMarkdown: (nextMarkdown, inline) => insertMarkdown(editor.get(), nextMarkdown, inline)
      }),
      [editor]
    );

    return <Milkdown />;
  }
);

function callMilkdownCommand<T>(
  editor: MilkdownEditorInstance,
  commandKey: CmdKey<T>,
  payload?: T
): boolean {
  return runEditorAction(editor, (ctx) => callCommand(commandKey, payload)(ctx));
}

function insertMarkdown(
  editor: MilkdownEditorInstance,
  markdown: string,
  inline?: boolean
): boolean {
  return runEditorAction(editor, (ctx) => {
    insert(markdown, inline)(ctx);
    return true;
  });
}

function runEditorAction(
  editor: MilkdownEditorInstance,
  action: Parameters<NonNullable<MilkdownEditorInstance>["action"]>[0]
): boolean {
  if (!editor) {
    return false;
  }

  try {
    const result = editor.action(action);
    editor.action((ctx) => {
      ctx.get(editorViewCtx).focus();
    });
    return Boolean(result);
  } catch {
    return false;
  }
}
