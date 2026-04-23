import rootConfig from "../eslint.config.js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  ...rootConfig,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Node script run at pulumi-up time; needs node globals (process,
    // console, fetch).
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "no-console": "off",
    },
  },
];
