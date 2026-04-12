export default {
  extends: [
    "@commitlint/config-conventional",
    "@commitlint/config-pnpm-scopes",
  ],
  rules: {
    "scope-enum": async (ctx) => {
      const {
        default: { rules },
      } = await import("@commitlint/config-pnpm-scopes");
      const [level, condition, scopes] = await rules["scope-enum"](ctx);
      return [level, condition, [...scopes, "wiki"]];
    },
  },
};
