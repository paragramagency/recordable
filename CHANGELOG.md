# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-06-27

### Added

- **New-tab recording.** `click(target, { followNewTab: true })` continues
  recording in a tab the click opens in, stitched seamlessly into the same
  output: the runtime arms `page.once("popup")` before the click, seals the
  current segment, sets up the new tab (viewport, cursor re-inject), waits for it
  to load off-camera, and switches capture to it (the old tab stays open).
  Schema-driven, so JSON and Markdown get it for free. (ROADMAP #5)
- **Composable `:text(…)` pseudo-selector.** Inner-text matching now composes
  with full CSS anywhere in a selector — `button:text(Save)`,
  `table tr:nth-child(3) td:text(Done)`. Bare/unquoted; substring match on the
  smallest containing element. The legacy whole-string `text:` prefix is kept as
  an alias.
- **Ambiguity warning.** The runtime warns (once per action) when a target
  resolves to more than one element, then acts on the first.
- **`select()` option pseudos.** Pick a `<select>` option without its `value`
  via `:option-index(N)` (1-based) or `:option-label(Text)`, resolved in-page
  against the live control.
- **`language` config.** A BCP-47 tag (e.g. `"fr-FR"`) sets the Chromium UI /
  `navigator.language` via the `--lang` launch flag and the `Accept-Language`
  request header. Empty (default) leaves the system locale.
- **`pageZoom` config.** Browser-level page zoom applied via
  `evaluateOnNewDocument`, so `pageZoom < 1` reflows layout to fit more on
  screen; persists across navigations and new tabs, and the cursor overlay
  tracks it.
- **Markdown `//` comments.** Whole-line `//` comments (the syntax VS Code
  injects on toggle-comment) are stripped from the markdown body before parsing,
  so author notes never compile into narration or a step; `//` mid-line (e.g. in
  a URL) is left untouched. (ROADMAP #8)
- **Test suite** wired into `npm test` / CI: unit (pure logic), I/O (real
  bundled ffmpeg via fixtures), and an opt-in E2E pipeline run
  (`npm run test:e2e`).

### Fixed

- `select()` passed the raw, unresolved target to `page.select`, so `:text()`
  targets didn't work on selects.

## [0.2.0] - 2026-06-27

### Changed

- Renamed `resumeOnInput()` → `resumeOnPlay()`, and split the gate out into a
  standalone `waitForPlay()` (blocks on ▶ Play without touching recording state);
  `resumeOnPlay()` is now just `waitForPlay().resume()`.
- `click()` no longer waits for navigation by default. The previous best-effort
  200ms post-click probe (which raced slow commits and could stall on busy pages)
  is gone — a click now returns immediately. Pass
  `click(target, { waitForNav: true })` when the click triggers a full-page
  navigation: the wait is armed _before_ the click (no probe race) and the
  navigation must land, like `visit()`.
  For SPA route changes or async content, follow with `waitFor(...)`.

### Fixed

- Cursor invisible during manual ▶ Play steps: the overlay no longer hides the
  native pointer (the screencast never captured the OS cursor, so hiding it only
  blanked the live headful pointer).
- `resume()` now restores the cursor to its `pause()` position, so a resumed
  segment opens with the cursor exactly where the previous one ended (off-camera
  steps or navigations between pause and resume no longer leave it stale).

## [0.1.0]

Initial release.

- In-house recorder: CDP `Page.startScreencast` → bundled ffmpeg → per-segment
  MP4 → concat. No `puppeteer-screen-recorder` peer-dependency conflict.
- Fluent chain of actions: clicks, typing, smooth zoom/scroll, animated cursor.
- `pause()` / `resume()` / `resumeOnInput()` with seamless segment stitching.
- `insert()` for external intros/outros/mid-rolls, with optional cross-fades.
- Declarative JSON authoring format with published JSON Schema and `recordable` CLI
  (`--check` to validate without a browser).

[Unreleased]: https://github.com/paragramagency/recordable/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/paragramagency/recordable/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/paragramagency/recordable/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/paragramagency/recordable/releases/tag/v0.1.0
