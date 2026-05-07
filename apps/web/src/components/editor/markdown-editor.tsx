import CharacterCount from "@tiptap/extension-character-count";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Code,
  Code2,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Strikethrough,
} from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";
import { Markdown } from "tiptap-markdown";

import { Toggle } from "#/components/ui/toggle";
import { cn } from "#/lib/utils";

import type { Editor } from "@tiptap/react";

// `tiptap-markdown` registers a `markdown` storage slot at runtime but
// doesn't augment TipTap's `Storage` type, so reach into it through a
// narrow accessor instead of sprinkling `as any` at every call site.
function getMarkdownFromEditor(editor: Editor): string {
  const storage = editor.storage as {
    markdown?: { getMarkdown: () => string };
  };
  return storage.markdown?.getMarkdown() ?? "";
}

// CharacterCount measures document text (not markdown syntax), so a
// 1500-char `**…**`-padded post counts ~1500. Close enough as a hard
// cap for UX — the schema's `.max()` on the markdown string is the
// authoritative validation.
function getCharacterCount(editor: Editor): number {
  const storage = editor.storage as {
    characterCount?: { characters: () => number };
  };
  return storage.characterCount?.characters() ?? 0;
}

const HEADING_LEVELS = [2, 3] as const;

// Pass-through HTML attributes for the contenteditable element. Kept
// narrow on purpose: today's only consumer is `fieldValidationAttrs`,
// which emits `aria-invalid` / `data-valid`. Widen this type instead
// of taking a free-form `Record<string, unknown>` so call sites can't
// accidentally inject id/class/style and clobber the editor's own.
export interface MarkdownEditorAttrs {
  "aria-invalid"?: boolean;
  "data-valid"?: "true";
}

export interface MarkdownEditorHandle {
  focus: () => void;
}

export function MarkdownEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  rows = 4,
  maxLength,
  ariaLabelledBy,
  ariaLabel,
  ariaDescribedBy,
  attrs,
  handleRef,
}: {
  value: string;
  onChange: (markdown: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  ariaLabelledBy?: string;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  // Pass-through HTML attributes for the contenteditable element —
  // e.g. `aria-invalid` / `data-valid` from `fieldValidationAttrs`.
  attrs?: MarkdownEditorAttrs;
  // Imperative handle so the parent's label can focus the editor on
  // click. Plain ref instead of forwardRef because the field is lazy-
  // loaded through Suspense, which routes ref through a wrapper layer
  // that can't carry React's special `ref` prop directly.
  handleRef?: React.MutableRefObject<MarkdownEditorHandle | null>;
}) {
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [...HEADING_LEVELS] },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        placeholder: placeholder ?? "",
        emptyEditorClass: "is-editor-empty",
      }),
      ...(maxLength !== undefined
        ? [CharacterCount.configure({ limit: maxLength })]
        : []),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        breaks: true,
      }),
    ],
    [placeholder, maxLength],
  );

  const editor = useEditor(
    {
      // TanStack Start SSRs the form, but ProseMirror needs `window` to
      // build its DOM — defer to client mount to avoid a hydration mismatch.
      immediatelyRender: false,
      extensions,
      content: value,
      editorProps: {
        attributes: {
          class: cn(
            "prose prose-sm dark:prose-invert max-w-none w-full",
            "rounded-md border border-input bg-transparent",
            "px-3 py-2 text-sm shadow-xs outline-none",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
            "[&_.ProseMirror-focused]:outline-none",
            "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
            // Placeholder visual: the extension adds `is-editor-empty`
            // to the first empty paragraph; render the placeholder via
            // a CSS pseudo-element so it doesn't pollute the doc.
            "[&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
            "[&_p.is-editor-empty:first-child]:before:text-muted-foreground",
            "[&_p.is-editor-empty:first-child]:before:pointer-events-none",
            "[&_p.is-editor-empty:first-child]:before:float-left",
            "[&_p.is-editor-empty:first-child]:before:h-0",
          ),
          role: "textbox",
          "aria-multiline": "true",
          ...(ariaLabelledBy ? { "aria-labelledby": ariaLabelledBy } : {}),
          ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
          ...(ariaDescribedBy ? { "aria-describedby": ariaDescribedBy } : {}),
          ...filterDefined(attrs),
          style: `min-height: ${rows * 1.5 + 1}rem;`,
        },
      },
      onUpdate: ({ editor: ed }) => {
        const md = getMarkdownFromEditor(ed);
        onChange(md);
      },
      onBlur: () => {
        onBlur?.();
      },
    },
    // Re-create the editor only when extension config changes; the
    // attribute object is rebuilt every render and would thrash here.
    [extensions],
  );

  // Keep the editor's content in sync when the parent resets the form
  // (e.g. after a successful submit). We compare against the serialized
  // markdown to avoid clobbering the cursor on every keystroke we just
  // emitted ourselves.
  useEffect(() => {
    if (!editor) {
      return;
    }
    const current = getMarkdownFromEditor(editor);
    if (current !== value) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [editor, value]);

  // Expose imperative focus to the parent (so the field label can focus
  // the editor on click). Cleared on unmount so a stale handle doesn't
  // outlive the editor instance.
  useEffect(() => {
    if (!handleRef) {
      return;
    }
    handleRef.current = editor
      ? { focus: () => editor.commands.focus() }
      : null;
    return () => {
      handleRef.current = null;
    };
  }, [editor, handleRef]);

  if (!editor) {
    return (
      <div
        className="bg-muted/30 w-full animate-pulse rounded-md border"
        style={{ minHeight: `${rows * 1.5 + 3}rem` }}
        aria-hidden
      />
    );
  }

  return (
    <div className="space-y-1.5">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
      {maxLength !== undefined ? (
        <CharacterCounter editor={editor} limit={maxLength} />
      ) : null}
    </div>
  );
}

function filterDefined(
  attrs: MarkdownEditorAttrs | undefined,
): Record<string, string> {
  if (!attrs) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) {
      continue;
    }
    out[k] = typeof v === "boolean" ? String(v) : v;
  }
  return out;
}

function CharacterCounter({
  editor,
  limit,
}: {
  editor: Editor;
  limit: number;
}) {
  // Reading from storage on every render is fine — the parent re-renders
  // on every onUpdate (via onChange), so the counter stays in sync.
  const count = getCharacterCount(editor);
  const remaining = limit - count;
  const warn = remaining <= Math.max(50, Math.floor(limit * 0.05));
  return (
    <div
      aria-live="polite"
      className={cn(
        "text-muted-foreground text-right text-xs",
        warn && "text-destructive",
      )}
    >
      {count} / {limit}
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const setLink = useCallback(() => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const next = window.prompt("Link URL", previous ?? "https://");
    if (next === null) {
      return;
    }
    if (next === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: next })
      .run();
  }, [editor]);

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap gap-0.5 rounded-md border bg-muted/30 p-1"
    >
      <ToolbarButton
        label="Bold"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Strikethrough"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Inline code"
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Link"
        active={editor.isActive("link")}
        onClick={setLink}
      >
        <LinkIcon className="size-3.5" />
      </ToolbarButton>
      <ToolbarSeparator />
      <ToolbarButton
        label="Heading 2"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Heading 3"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 className="size-3.5" />
      </ToolbarButton>
      <ToolbarSeparator />
      <ToolbarButton
        label="Bullet list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Task list"
        active={editor.isActive("taskList")}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        <ListChecks className="size-3.5" />
      </ToolbarButton>
      <ToolbarSeparator />
      <ToolbarButton
        label="Blockquote"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Code block"
        active={editor.isActive("codeBlock")}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <Code2 className="size-3.5" />
      </ToolbarButton>
    </div>
  );
}

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Toggle
      type="button"
      size="sm"
      variant="default"
      pressed={active}
      onPressedChange={onClick}
      aria-label={label}
      title={label}
      className="size-7 p-0"
    >
      {children}
    </Toggle>
  );
}

function ToolbarSeparator() {
  return <div aria-hidden className="mx-0.5 w-px self-stretch bg-border" />;
}
