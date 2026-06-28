# recordable — agent guide

## Commit messages

This repo uses [Conventional Commits](https://www.conventionalcommits.org),
enforced by `commitlint` (a local `commit-msg` hook and CI on PRs). Every commit
you author must conform, or the hook rejects it.

Format: `<type>(<optional scope>): <imperative summary ≤72 chars>`, optional body
(what & why, wrapped ~72), optional footer.

- **Types:** `feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci`
  `chore` `revert`. Nothing else passes.
- **Bump mapping (SemVer):** `feat` → minor, `fix` → patch, `BREAKING CHANGE:`
  footer or `type!:` → major.
- **Scope** optional/freeform — the area touched, e.g. `feat(markdown):`,
  `fix(cli):`, `docs(readme):`.
- Keep the `Co-Authored-By:` trailer in the footer (after a blank line).
- `Release vX.Y.Z` and `Merge …` commits are exempt (commitlint ignores them);
  don't hand-author other non-conforming messages.

Full reference: `CONTRIBUTING.md` → "Commit messages". Config:
`commitlint.config.js`, hook in `.husky/commit-msg`, template in `.gitmessage`.
