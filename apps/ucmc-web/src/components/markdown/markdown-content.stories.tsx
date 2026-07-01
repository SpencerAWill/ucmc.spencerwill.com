import type { Meta, StoryObj } from "@storybook/react-vite";

import { MarkdownContent } from "./markdown-content";

const meta = {
  title: "Markdown/MarkdownContent",
  component: MarkdownContent,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof MarkdownContent>;

export default meta;
type Story = StoryObj<typeof meta>;

const SAMPLE = `## Steps to reproduce

1. Open the app on **iPhone 15 Pro**
2. Tap *Sign in*
3. Observe the layout shift

## Notes

- A bullet point
- Another with a [link](https://example.com)

### Tasks

- [x] Reproduce locally
- [ ] Fix the layout
- [ ] Add a regression test

> A quoted line for emphasis.

\`\`\`
some code block
with multiple lines
\`\`\`

Inline \`code\` works too. ~~struck through~~`;

export const Default: Story = {
  args: { children: SAMPLE },
};

export const Empty: Story = {
  args: { children: "" },
};

export const StructuredFeedback: Story = {
  args: {
    children: `**Describe the bug**\n\nThe sign-in button is offscreen on iOS Safari.\n\n**Steps to reproduce**\n\n1. Open on iPhone\n2. Tap *Sign in*\n\n**Expected behavior**\n\nButton should be visible.`,
  },
};
