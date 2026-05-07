import { Toolbar as BaseToolbar } from "@base-ui/react";
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
import { useCallback, useEffect, useMemo, useRef } from "react";
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

// Defense-in-depth on top of TipTap Link's own `isAllowedUri` filter:
// reject anything that isn't an http(s), mailto, tel, or relative/anchor
// URL before we hand it to `setLink`. Stops `javascript:` / `data:` /
// `vbscript:` even if a future Link config widens its allowlist.
const SAFE_PROTOCOL = /^(?:https?:|mailto:|tel:|\/|#|\?|[^:]+$)/i;

export function isSafeLinkUrl(url: string): boolean {
  return SAFE_PROTOCOL.test(url.trim());
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
  // The editor is created once per mount, so anything captured directly
  // in its config object freezes at first-mount. Route everything that
  // can change through refs we update each render.
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  const placeholderRef = useRef(placeholder);
  const maxLengthRef = useRef(maxLength);
  // Last markdown string that fit within `maxLength`. We revert to it
  // when a transaction would push the editor over the cap (e.g. a paste).
  const lastAcceptedRef = useRef(value);
  useEffect(() => {
    onChangeRef.current = onChange;
    onBlurRef.current = onBlur;
    placeholderRef.current = placeholder;
    maxLengthRef.current = maxLength;
  });

  const extensions = useMemo(
    // Built once. Dynamic values (`placeholder`, `maxLength`) are read
    // through refs from inside the extensions / update callback, so
    // changing those props doesn't re-create the editor and clobber
    // the user's cursor mid-typing.
    () => [
      StarterKit.configure({
        heading: { levels: [...HEADING_LEVELS] },
        // StarterKit v3 ships its own Link; disable it so our
        // configured one (autolink + new-tab attrs) is the sole copy.
        link: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        placeholder: () => placeholderRef.current ?? "",
        emptyEditorClass: "is-editor-empty",
      }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        breaks: true,
      }),
    ],
    [],
  );

  const editorAttributes = useMemo(
    () => ({
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
    }),
    [ariaLabelledBy, ariaLabel, ariaDescribedBy, attrs, rows],
  );

  const editor = useEditor(
    {
      // TanStack Start SSRs the form, but ProseMirror needs `window` to
      // build its DOM — defer to client mount to avoid a hydration mismatch.
      immediatelyRender: false,
      extensions,
      content: value,
      editorProps: { attributes: editorAttributes },
      onUpdate: ({ editor: ed }) => {
        const md = getMarkdownFromEditor(ed);
        const cap = maxLengthRef.current;
        // Cap on the markdown string length — the same value the zod
        // schema's `.max()` validates against. Keeps the editor's
        // hard-stop and the schema's accept-criteria in lockstep.
        if (cap !== undefined && md.length > cap) {
          ed.commands.setContent(lastAcceptedRef.current, {
            emitUpdate: false,
          });
          return;
        }
        lastAcceptedRef.current = md;
        onChangeRef.current(md);
      },
      onBlur: () => {
        onBlurRef.current?.();
      },
    },
    [extensions],
  );

  // `editorProps.attributes` is read once at init, so prop-derived bits
  // (`aria-invalid`, `data-valid`, `aria-labelledby`, etc.) would never
  // update when field meta flips. Push them through `setOptions` on
  // every change so the contenteditable DOM stays in sync.
  useEffect(() => {
    if (!editor) {
      return;
    }
    editor.setOptions({ editorProps: { attributes: editorAttributes } });
  }, [editor, editorAttributes]);

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
      lastAcceptedRef.current = value;
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
  // Counts the markdown string length so the displayed value matches
  // what the zod `.max()` validator and the editor's hard-stop both use.
  const count = getMarkdownFromEditor(editor).length;
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
    if (!isSafeLinkUrl(next)) {
      window.alert(
        "That link can't be inserted. Use an http(s), mailto, tel, or relative URL.",
      );
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
    // base-ui Toolbar gives a single tab-stop with arrow-key roving
    // focus across the buttons (per ARIA Authoring Practices).
    <BaseToolbar.Root
      aria-label="Formatting"
      className="flex flex-wrap gap-0.5 rounded-md border bg-muted/30 p-1"
    >
      <ToolbarToggle
        label="Bold"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="size-3.5" />
      </ToolbarToggle>
      <ToolbarToggle
        label="Italic"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="size-3.5" />
      </ToolbarToggle>
      <ToolbarToggle
        label="Strikethrough"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="size-3.5" />
      </ToolbarToggle>
      <ToolbarToggle
        label="Inline code"
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code className="size-3.5" />
      </ToolbarToggle>
      <ToolbarToggle
        label="Link"
        active={editor.isActive("link")}
        onClick={setLink}
      >
        <LinkIcon className="size-3.5" />
      </ToolbarToggle>
      <BaseToolbar.Separator className="mx-0.5 w-px self-stretch bg-border" />
      <ToolbarToggle
        label="Heading 2"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 className="size-3.5" />
      </ToolbarToggle>
      <ToolbarToggle
        label="Heading 3"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 className="size-3.5" />
      </ToolbarToggle>
      <BaseToolbar.Separator className="mx-0.5 w-px self-stretch bg-border" />
      <ToolbarToggle
        label="Bullet list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="size-3.5" />
      </ToolbarToggle>
      <ToolbarToggle
        label="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="size-3.5" />
      </ToolbarToggle>
      <ToolbarToggle
        label="Task list"
        active={editor.isActive("taskList")}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        <ListChecks className="size-3.5" />
      </ToolbarToggle>
      <BaseToolbar.Separator className="mx-0.5 w-px self-stretch bg-border" />
      <ToolbarToggle
        label="Blockquote"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote className="size-3.5" />
      </ToolbarToggle>
      <ToolbarToggle
        label="Code block"
        active={editor.isActive("codeBlock")}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <Code2 className="size-3.5" />
      </ToolbarToggle>
    </BaseToolbar.Root>
  );
}

function ToolbarToggle({
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
  // base-ui's Toolbar.Button owns the roving-tabindex behavior; we
  // render shadcn's Toggle inside it so the `data-state="on"` styling
  // (pressed-state visuals) keeps working.
  return (
    <BaseToolbar.Button
      render={
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
      }
    />
  );
}
