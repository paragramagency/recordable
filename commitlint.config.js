// Conventional Commits, enforced via the .husky/commit-msg hook (local) and CI
// (PR commits). See CONTRIBUTING.md → "Commit messages".
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Allow the types we actually use, including `ci`/`build`/`chore`/`revert`.
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "perf",
        "test",
        "build",
        "ci",
        "chore",
        "revert",
      ],
    ],
    // Release commits ("Release v0.4.0") and merge commits are exempt — see
    // `ignores` below — so the only hard rules are a known type + a subject.
    "subject-case": [0], // don't dictate sentence/lower case in the subject
    "body-max-line-length": [0], // long URLs / Co-Authored-By trailers are fine
    "footer-max-line-length": [0],
  },
  // Skip messages we generate that don't follow the convention by design.
  ignores: [
    (msg) => /^Release v\d/.test(msg),
    (msg) => msg.startsWith("Merge "),
  ],
};
