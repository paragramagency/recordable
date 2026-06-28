# Contributing

Thanks for your interest in improving `recordable`.

## Setup

Requires Node.js >= 18.

```bash
npm install
```

## Common tasks

```bash
npm run build        # compile src/ → dist/ (tsc)
npm run gen:schema   # regenerate recordable.schema.json from src/script.ts
npm run clean        # remove dist/
```

## Project layout

- `src/` — the package source; the only thing compiled to `dist/` and published.
- `demos/` — runnable examples; not part of the published package.
- `scripts/` — build tooling (e.g. schema generation); not published.
- `recordable.schema.json` — generated; do not edit by hand. Run `npm run gen:schema`.

The published tarball is restricted by the `files` field in `package.json`. If you
add a top-level file that should ship, add it there.

## Commit messages

This repo follows [Conventional Commits](https://www.conventionalcommits.org).
It pairs with the SemVer + [Keep a Changelog](https://keepachangelog.com) flow
in `CHANGELOG.md`, and `commitlint` enforces it (locally via a Git hook, and on
PRs in CI).

```
<type>(<optional scope>): <imperative summary, ≤72 chars>

<optional body — what & why, wrapped ~72 chars>

<optional footer — BREAKING CHANGE: …, Closes #123, Co-Authored-By: …>
```

- **Types:** `feat` · `fix` · `docs` · `style` · `refactor` · `perf` · `test` ·
  `build` · `ci` · `chore` · `revert`.
- **Version bump:** `feat` → minor, `fix` → patch, a `BREAKING CHANGE:` footer
  (or `!` after the type, e.g. `feat!:`) → major.
- **Scope** is optional and freeform — the area touched, e.g. `feat(markdown):`,
  `fix(cli):`, `docs(readme):`.
- Examples: `fix(scroll): thread FRAME_MS through the evaluate() args`,
  `feat(select): add :option-index / :option-label pseudos`.

`npm install` installs the hook and points `git commit` at a template
(`.gitmessage`) that spells the format out. `Release vX.Y.Z` and merge commits
are exempt. Lint a message by hand with `npx commitlint --edit <file>`.

## Before opening a PR

- Run `npm run gen:schema` and commit the result if `src/script.ts` changed —
  CI fails if the committed schema is stale.
- Run `npm run build` to confirm the package compiles.
- Validate any new sample scripts with `node dist/cli.js <script>.json --check`.

## Releasing

`npm run prepublishOnly` runs `clean → gen:schema → build` automatically on
`npm publish`. Update `CHANGELOG.md` and bump the version (`npm version <patch|minor|major>`)
before publishing.
