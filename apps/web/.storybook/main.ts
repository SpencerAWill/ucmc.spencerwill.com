import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  addons: [],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  core: {
    // Storybook binds to 0.0.0.0 in dev containers so VS Code can forward the
    // port; restrict which Host headers are accepted to prevent DNS-rebinding.
    // Strings prefixed with `.` match subdomains (Vite's allowedHosts syntax).
    allowedHosts: ["localhost", "127.0.0.1", ".github.dev", ".app.github.dev"],
  },
  async viteFinal(config) {
    const { default: tailwindcss } = await import("@tailwindcss/vite");
    config.plugins = config.plugins || [];
    config.plugins.push(tailwindcss());
    return config;
  },
};
export default config;
