import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { MarkdownContent } from "#/components/markdown/markdown-content";

import { MarkdownEditor } from "./markdown-editor";

const meta: Meta<typeof MarkdownEditor> = {
  title: "Markdown/MarkdownEditor",
  component: MarkdownEditor,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof MarkdownEditor>;

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <h4 className="mb-2 text-sm font-semibold">Editor</h4>
        <MarkdownEditor
          value={value}
          onChange={setValue}
          ariaLabel="Editor"
          rows={6}
        />
      </div>
      <div>
        <h4 className="mb-2 text-sm font-semibold">Preview</h4>
        <div className="rounded-md border p-3">
          <MarkdownContent>{value}</MarkdownContent>
        </div>
      </div>
    </div>
  );
}

export const Empty: Story = {
  render: () => <Harness initial="" />,
};

export const PrePopulated: Story = {
  render: () => (
    <Harness
      initial={`## Heading 2\n\nSome **bold** and *italic* text with a [link](https://example.com).\n\n- bullet one\n- bullet two\n\n- [ ] open task\n- [x] done task\n\n> A quote.\n\n\`\`\`\nfenced code\n\`\`\``}
    />
  ),
};
