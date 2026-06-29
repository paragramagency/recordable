import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  // `.claude` can hold nested git worktrees (a full repo copy) that would
  // otherwise be linted with the wrong tsconfig root — never our source.
  // `extensions` holds standalone Chrome-runtime bundles (chrome.*/window
  // globals, plain JS) loaded into the browser — not part of our TS build.
  {
    ignores: [
      "dist",
      "node_modules",
      "output",
      "demos",
      ".claude",
      "extensions",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Plain-JS Node scripts (e.g. build-extension.mjs) run outside the TS build,
  // so give them the Node globals `no-undef` otherwise flags.
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
  },
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
