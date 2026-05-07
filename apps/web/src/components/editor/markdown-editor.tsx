import Link from "@tiptap/extension-link";
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
import { useCallback, useEffect } from "react";
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

const EXTENSIONS = [
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
  Markdown.configure({
    html: false,
    transformPastedText: true,
    breaks: true,
  }),
];

export function MarkdownEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  rows = 4,
  ariaLabel,
  ariaDescribedBy,
  id,
}: {
  value: string;
  onChange: (markdown: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  rows?: number;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  id?: string;
}) {
  const editor = useEditor({
    // TanStack Start SSRs the form, but ProseMirror needs `window` to
    // build its DOM — defer to client mount to avoid a hydration mismatch.
    immediatelyRender: false,
    extensions: EXTENSIONS,
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
        ),
        role: "textbox",
        "aria-multiline": "true",
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
        ...(ariaDescribedBy ? { "aria-describedby": ariaDescribedBy } : {}),
        ...(id ? { id } : {}),
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
  });

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

  if (!editor) {
    return (
      <div
        className="bg-muted/30 h-[6rem] w-full animate-pulse rounded-md border"
        aria-hidden
      />
    );
  }

  return (
    <div className="space-y-1.5" data-placeholder={placeholder}>
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
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
