import rootConfig from "../eslint.config.js";
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
];
