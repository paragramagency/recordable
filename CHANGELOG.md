# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/paragramagency/recordable/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/paragramagency/recordable/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/paragramagency/recordable/releases/tag/v0.1.0
