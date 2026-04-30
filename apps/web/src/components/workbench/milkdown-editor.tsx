"use client";

import { defaultValueCtx, Editor, editorViewOptionsCtx, rootCtx } from "@milkdown/kit/core";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { ENABLED_MILKDOWN_PRESETS, type MilkdownPreset } from "@openkb/editor";
import { useEffect, useRef } from "react";

export type MilkdownEditorProps = {
  markdown: string;
  editable: boolean;
  onChange: (markdown: string) => void;
};

const milkdownPresetPlugins = {
  "@milkdown/kit/preset/commonmark": commonmark,
  "@milkdown/kit/preset/gfm": gfm
} satisfies Record<MilkdownPreset, typeof commonmark>;

export function MilkdownEditor(props: MilkdownEditorProps) {
  return (
    <MilkdownProvider>
      <MilkdownEditorInner {...props} />
    </MilkdownProvider>
  );
}

function MilkdownEditorInner({ markdown, editable, onChange }: MilkdownEditorProps) {
  const onChangeRef = useRef(onChange);
  const initialMarkdownRef = useRef(markdown);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEditor(
    (root) => {
      const editor = Editor.make().config((ctx) => {
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
        editor.use(milkdownPresetPlugins[preset]);
      }

      return editor.use(history).use(listener);
    },
    [editable]
  );

  return <Milkdown />;
}
