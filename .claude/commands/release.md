---
description: Audit unreleased commits, update docs, bump version, commit/tag/push a release
---

Cut a new release of `recordable`. Work through these steps in order. Be concise.

## 1. Survey what's unreleased

- `git log $(git describe --tags --abbrev=0)..HEAD --oneline` — commits since the last tag.
- `git log @{u}..HEAD --oneline` and `git status -s` — confirm what's unpushed / uncommitted.
- Read the full message of each feature/fix commit (`git show -s --format='%s%n%n%b' <sha>`) so the changelog reflects what actually changed, not just the subject line.
- If there are **no** unreleased commits, stop and tell the user — nothing to release.

## 2. Audit the code

- Run `npm run lint`, `npm run format:check`, `npm run build`, and `npm test` — these mirror the CI gates and must all pass before releasing. If any fails, stop and report — do not release broken code (`npm run lint:fix` / `npm run format` fix most lint/format issues).
- Skim the actual diff since the last tag (`git diff $(git describe --tags --abbrev=0)..HEAD`) for anything that contradicts the commit messages or needs documenting (new config keys, new method options, behaviour changes, removed APIs).

## 3. Decide the version bump (SemVer, pre-1.0 rules)

Project is pre-1.0, so:

- **Breaking change** (removed/renamed public API, changed defaults that break callers) → bump the **minor** (`0.x.0`).
- **New feature, backwards-compatible** → bump the **minor** (`0.x.0`).
- **Only fixes / docs / internal** → bump the **patch** (`0.x.y`).

State the chosen version and the one-line reason before editing files.

## 4. Update the docs

- **CHANGELOG.md** — follows [Keep a Changelog](https://keepachangelog.com/). Add a new `## [x.y.z] - YYYY-MM-DD` section under `## [Unreleased]`, grouped into `### Added` / `### Changed` / `### Fixed` / `### Removed` as applies. One entry per user-visible change, written from the user's perspective (reference ROADMAP item numbers where relevant). Update the compare links at the bottom: point `[Unreleased]` at `vX.Y.Z...HEAD` and add a `[x.y.z]: …/compare/<prev>...vX.Y.Z` line. Use today's date.
- **README.md** — only if the release changes the public surface (new method/option/config, changed behaviour). Update Features, the API tables, Configuration block, and any relevant note. Don't touch it for internal-only changes.
- **ROADMAP.md** — move any now-shipped items into the **Done** section (concise summary, with the spec link if one exists), and mark the corresponding `### N.` entry done with `### N. ~~Title~~ — Done` + a one-line pointer to Done. Update the Cleanup/tech-debt list if a tracked item is now resolved.

## 5. Bump the version

- Edit `version` in `package.json`.
- Update the two `"version"` fields near the top of `package-lock.json` to match.

## 6. Commit, tag, push

The user asked for a release, so this is authorized — proceed without re-confirming (but stop if anything in steps 1–2 failed).

- Stage everything: `git add -A`.
- Commit with a `Release vX.Y.Z` subject and a short body summarising the headline changes. End the message with:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- Annotated tag: `git tag -a vX.Y.Z -m "vX.Y.Z"`.
- Push both: `git push origin main && git push origin vX.Y.Z`.

## 7. Report

Summarise: version released, the changelog highlights, which docs changed, and confirm build/test were green and the push + tag succeeded.
