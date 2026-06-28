---
description: Audit unreleased commits, update docs, bump version, ship via a release PR, then tag
---

Cut a new release of `recordable`. Work through these steps in order. Be concise.

## 1. Survey what's unreleased

- `git log $(git describe --tags --abbrev=0)..HEAD --oneline` — commits since the last tag.
- `git log @{u}..HEAD --oneline` and `git status -s` — confirm what's unpushed / uncommitted.
- Read the full message of each feature/fix commit (`git show -s --format='%s%n%n%b' <sha>`) so the changelog reflects what actually changed, not just the subject line.
- If there are **no** unreleased commits, stop and tell the user — nothing to release.

## 2. Audit the code

- Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run build`, and `npm test` — these mirror the CI gates and must all pass before releasing. If any fails, stop and report — do not release broken code (`npm run lint:fix` / `npm run format` fix most lint/format issues). `npm run typecheck` type-checks the whole project including `test/` (which `tsx` only transpiles, so type errors there slip past `build` and `test`).
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

## 6. Open the release PR

`main` is protected by a ruleset (required CI checks + a PR before merge), so a release lands through a PR, **not** a direct push. Creating the branch, commit, and PR are authorized by the release request — proceed without re-confirming (but stop if anything in steps 1–2 failed). **The merge itself requires explicit approval** — see the merge bullet below.

- Create a release branch off `main`: `git checkout -b release/vX.Y.Z`.
- Stage everything: `git add -A`.
- Commit with a `Release vX.Y.Z` subject and a short body summarising the headline changes (commitlint is configured to exempt `Release vX` subjects, so this passes the hook and the CI `commitlint` job). End the message with:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- Push and open the PR: `git push -u origin release/vX.Y.Z`, then `gh pr create --base main --title "Release vX.Y.Z" --body "<headline summary>"`.
- Wait for CI to pass: `gh pr checks --watch`. The ruleset requires `build (20)`, `build (22)`, `build (24)`, `audit`, and `commitlint` to be green. If any check fails, **stop and report** — do not merge.
- **Request approval to merge.** Once the checks are green, share the PR link and the check summary and **ask the user to approve the merge — do not merge unprompted.** Only after they approve, merge from the GitHub CLI: `gh pr merge --squash --delete-branch` (with the admin bypass and 0 required approvals, this merges as soon as the required checks pass — no `--admin` force needed). It lands a single `Release vX.Y.Z (#N)` commit on `main` carrying the version bump.

## 7. Tag the merged release

The **tag** — not the branch push — is what publishes: `release.yml` runs on `v*` tags (npm publish via OIDC + a GitHub Release from the changelog). Tags aren't covered by the branch ruleset, so the tag pushes directly.

- Sync local `main` to the merged commit: `git checkout main && git pull`.
- Sanity-check the version landed: `node -p "require('./package.json').version"` must equal `X.Y.Z` (the `release.yml` guard fails the publish if the tag and `package.json` disagree).
- Annotated tag on the merge result: `git tag -a vX.Y.Z -m "vX.Y.Z"`.
- Push the tag: `git push origin vX.Y.Z`.
- Watch the publish workflow: `gh run watch` (or `gh run list --workflow=release.yml`). If it fails, report — the tag is pushed but nothing was published.

## 8. Clean up the release branch

`gh pr merge --squash --delete-branch` deletes the remote branch **only if it
succeeds end-to-end** — and it can silently skip the delete when the local repo
has a worktree whose name collides with `main` (e.g. a release cut from a
separate worktree), leaving `origin/release/vX.Y.Z` plus the local branch and
worktree behind. After the publish workflow is green, reconcile:

- If the release was cut in a dedicated worktree, remove it:
  `git worktree remove --force <path>` (force is fine — only `node_modules` is
  ever untracked there), then `git worktree prune`.
- Delete the local release branch: `git branch -D release/vX.Y.Z`.
- Delete the remote branch if it survived the merge:
  `git push origin --delete release/vX.Y.Z 2>/dev/null || true`.
- Confirm with `git worktree list` and `git branch` that only `main` (and any
  genuinely active work) remains.

## 9. Report

Summarise: version released, the changelog highlights, which docs changed, confirm the local gates were green, the PR number and that its checks passed and it merged, that the tag pushed and the publish workflow succeeded (or its status if still running), and that the release branch/worktree were cleaned up.
