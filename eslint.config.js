import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  // `.claude` can hold nested git worktrees (a full repo copy) that would
  // otherwise be linted with the wrong tsconfig root — never our source.
  { ignores: ["dist", "node_modules", "output", "demos", ".claude"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The `injectPlayButton`/cursor scripts cast `window` to call exposed
      // bindings — `any`-ish casts are deliberate and self-contained.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  prettier,
);
