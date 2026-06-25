# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0]

Initial release.

- In-house recorder: CDP `Page.startScreencast` → bundled ffmpeg → per-segment
  MP4 → concat. No `puppeteer-screen-recorder` peer-dependency conflict.
- Fluent chain of actions: clicks, typing, smooth zoom/scroll, animated cursor.
- `pause()` / `resume()` / `resumeOnInput()` with seamless segment stitching.
- `insert()` for external intros/outros/mid-rolls, with optional cross-fades.
- Declarative JSON authoring format with published JSON Schema and `recordable` CLI
  (`--check` to validate without a browser).

[Unreleased]: https://github.com/paragramagency/recordable/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/paragramagency/recordable/releases/tag/v1.0.0
