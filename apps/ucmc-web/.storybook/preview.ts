// First, like every other entry point: stories render the same Temporal
// implementation prod and SSR do (see src/lib/temporal-install.ts).
import "../src/lib/temporal-install";
import type { Preview } from "@storybook/react-vite";
import "../src/styles.css";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
