# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.10.0] - 2026-06-29

### Added

- **`:nth(N)` target pseudo.** Pick the Nth element (1-based, document order)
  among everything a selector matches — unlike CSS `:nth-child`/`:nth-of-type`,
  which only count among siblings. It composes with `:text()`:
  `"a:text(Submit):nth(2)"` is the second link whose text contains
  "Submit"; `"button[type=submit]:nth(2)"` the second submit button.
  Indexing is over _visible_ matches (hidden duplicates such as a mirrored mobile
  menu are skipped) and is resolved across frames like any other target. It must
  be the single, trailing marker on a target; a mid-selector or malformed marker
  is a config error naming the target.
- **Selector-picker browser extension** (`extensions/selector-picker/`, a
  repo-only dev tool — not part of the npm package). A small MV3 Chrome extension
  for authoring targets: arm it from the toolbar, hover to highlight, click to
  copy a unique target in recordable's grammar. It promotes the click to the
  nearest control, prefers `:text()` → `#id` → `[attr]` (test hooks, accessible
  name, `data-*`, …) → `…:nth(K)` → CSS path, and works inside iframes. Built to
  a zip with `npm run build:extension`.

## [0.9.0] - 2026-06-29

### Added

- **Variables.** Define reusable values once and reference them with `{{ name }}`
  in any action string argument (selectors, `visit` URLs, typed text, asset
  paths) and in Markdown narration prose. Provide them programmatically
  (`new Recordable({ variables })`, `.variables(map)`, `.variable(name, value)`),
  as a `variables` sibling in a JSON script, as a `variables:` block in Markdown
  frontmatter, or on the CLI (`--var name=value`, repeatable). Names are case-
  and separator-insensitive (`VAR_EMAIL_ADDRESS` ≡ `{{emailAddress}}` ≡
  `{{email_address}}`); `\{{name}}` is a literal, `{{ non-name }}` is left
  verbatim, and a missing variable is a hard error naming it and the sources
  searched. Resolution is at enqueue time and chain-ordered. (ROADMAP #2)
- **`recordable.config.json`** — a committed, non-secret config file: flat config
  keys plus reserved `variables` and `voiceover` sections, natively typed and
  validated. Both it and `.env` are discovered by walking from the script's
  folder up to the current directory and depth-merged, deeper overriding
  shallower per key. A published `recordable.config.schema.json` drives editor
  autocomplete, and the script schema gained a `variables` property.
- **Secret variables** via a `VAR_` prefix in `.env` (e.g. `VAR_ADMIN_PASSWORD`),
  joined with `process.env VAR_*`.
- **CLI flags** `--config <path>` / `--env-file <path>` (override auto-discovery)
  and `--base-dir <path>` (the directory the config/`.env` walk starts from).

### Changed

- **`.env` is now secrets only** (`ELEVENLABS_API_KEY`, `VAR_*`). Non-secret
  recording config moves to `recordable.config.json`, and the voiceover
  provider/voice/model defaults move to that file's `voiceover` section.
- **Variable precedence** is type-major — every variables source outranks every
  env source: `.env VAR_*` < `process.env VAR_*` < `recordable.config.json`
  `variables` < frontmatter / JSON `variables` < programmatic (constructor /
  `.variables()` / `.variable()` / `--var`). Config precedence is now
  defaults < `recordable.config.json` < document config < constructor / CLI.

### Removed

- **The `DEFAULT_<UPPER_SNAKE>` env-config prefix** (`DEFAULT_FPS`,
  `DEFAULT_VIEWPORT`, …) and its string coercion. **Migration:** move these into
  `recordable.config.json` as native-typed keys (e.g. `{ "fps": 30 }`).
- **The voiceover env defaults** `DEFAULT_TTS_PROVIDER` / `DEFAULT_VOICE_ID` /
  `DEFAULT_MODEL_ID`. **Migration:** set `provider` / `voiceId` / `modelId` in the
  `voiceover` section of `recordable.config.json` (or per-document frontmatter).
  `ELEVENLABS_API_KEY` is unchanged.

## [0.8.1] - 2026-06-29

### Fixed

- **Clicking / hovering / scrolling elements inside a dialog iframe.** v0.8.0
  resolves targets inside iframes (e.g. modal dialogs), but the scroll and
  metrics helpers still evaluated the element against the top page, throwing
  `JSHandles can be evaluated only in the context they were created` for any
  target in an iframe (such as an APEX modal confirm button). They now evaluate
  against the element's own frame, so interactions inside dialog iframes work.

## [0.8.0] - 2026-06-28

### Added

- **Horizontal container scrolling.** `scroll` gained an `axis: "x" | "y"` option
  (default `"y"`) and `"left"` / `"right"` keywords (which infer the x axis). A
  number or selector target scrolls horizontally with `axis: "x"`, e.g.
  `scroll("right", { container: ".row" })` or
  `scroll("#card-7", { container: ".row", axis: "x" })`. Vertical behaviour is
  unchanged. (ROADMAP #1)
- **`.env` default configuration.** A `.env` beside the document now defaults
  **any** config option as `DEFAULT_<UPPER_SNAKE>` (`DEFAULT_FPS`,
  `DEFAULT_VIEWPORT=1920x1080`, `DEFAULT_LAUNCH_ARGS=--no-sandbox,--foo`, …),
  coerced to each field's type — so a folder of demos shares one setup.
  Precedence, low → high: built-in defaults → `.env` → frontmatter / JSON
  `config` → explicit `new Recordable({...})` / CLI flags. (ROADMAP #2)
- **`include(...)` in Markdown.** A standalone `include("./login.md")` — its own
  fenced line or paragraph — splices another script's steps and narration in at
  that point, resolving against its own folder (nested includes supported, cycles
  caught). The included file's frontmatter is ignored; the top-level document's
  config wins. (ROADMAP #3)
- **`Recordable.getConfig()`** returns the fully-resolved config snapshot (after
  all layering and `baseDir` path resolution).

### Changed

- **Voiceover env vars renamed `RECORDABLE_*` → `DEFAULT_*`** for consistency with
  the new config defaults (`RECORDABLE_TTS_PROVIDER` → `DEFAULT_TTS_PROVIDER`,
  `RECORDABLE_VOICE_ID` → `DEFAULT_VOICE_ID`, `RECORDABLE_MODEL_ID` →
  `DEFAULT_MODEL_ID`). The `ELEVENLABS_API_KEY` secret is unchanged. **Migration:**
  rename these keys in any existing `.env`.

## [0.7.0] - 2026-06-28

### Added

- **Auto-trim same-tab navigation load off-camera (`trimNavigation`, default
  true).** A `visit()` or a `waitForNav` click now seals the segment at the action
  and runs the page load off-camera, so the clip cuts straight from action to
  result with no dead loading time — generalising the new-tab off-camera trim
  (`followNewTab`) to same-tab navigation. Because the load captures no frames it
  never advances the recorded timeline, keeping voiceover timing deterministic.
  Override per click with `click(t, { trimNavigation: false })`; flows through
  JSON / Markdown. (ROADMAP #2)

## [0.6.0] - 2026-06-28

### Changed

- **Minimum Node.js is now 22** (`engines.node: ">=22"`), up from 20, and CI
  runs on Node 22 and 24 (the Node 20 leg is dropped). The toolchain moved past
  Node 20: Puppeteer 25 requires Node ≥ 22.12 and `lint-staged` 17 requires
  ≥ 22.22. Node 20 consumers should stay on 0.5.x.
- **Bundled Puppeteer upgraded 22 → 25.** The 22.x line is no longer supported
  upstream. No API change for recordable callers.
- **Dev/CI toolchain bumps:** TypeScript 6, `@types/node` 26, `lint-staged` 17,
  and the `actions/checkout` / `actions/setup-node` GitHub Actions (v7 / v6).

## [0.5.0] - 2026-06-28

### Added

- **Recording control & multiple output files.** `start()` / `end()` / `split()`
  move the recording's _file_ boundaries — distinct from `pause()` / `resume()`,
  which carve off-camera gaps _within_ one file — so a single script can emit
  several MP4s: `start("intro")` … `split("checkout")` … `end()` →
  `demo-intro.mp4`, `demo-checkout.mp4`. Boundaries default to the script edges,
  so a plain top-to-bottom script is still a single file, unchanged. Each file is
  a standalone deliverable with its own zero-based audio timeline, and `run()`
  now resolves to a `RecordableResult` describing every file written (path,
  label, duration, size) plus any warnings. Available programmatically and in
  JSON / Markdown (`start` / `end` / `split` actions). (ROADMAP #6)

### Changed

- **Minimum Node.js is now 20** (`engines.node: ">=20"`), up from 18. Node 18
  reached end-of-life in April 2025 and the lint toolchain (eslint 10) already
  requires Node ≥ 20.19. CI now runs on Node 20, 22, and 24.

### Fixed

- **Audio mixing and cross-fades on Linux.** The bundled ffmpeg now comes from
  `ffmpeg-static` (current ffmpeg 6.x on every platform) instead of
  `@ffmpeg-installer/ffmpeg`, whose Linux binary was 4.1 — too old for `xfade`
  (cross-fades, ffmpeg 4.3) and `adelay`'s `all` option (audio overlays, 4.2).
  Both silently failed on Linux; they now work. A system `ffmpeg` on `PATH`
  remains the fallback.

## [0.4.0] - 2026-06-28

### Added

- **Container scrolling.** `scroll(target, { container })` scrolls a named
  overflow pane (modal, sidebar, scrollable list) instead of the window —
  `target` resolves `"top"`/`"bottom"`/an absolute Y/a selector against that
  container (centring a child within it). Auto-scroll-before-action now also
  reveals a target nested in a scrollable ancestor: it scrolls that container
  first, then brings the container itself on screen. (ROADMAP #10)

### Changed

- **`pageZoom` is now genuine browser page zoom.** It's applied via a bundled,
  per-run MV3 extension driving `chrome.tabs.setZoom` (what Ctrl +/− does)
  instead of CSS `zoom` on the document. Page zoom keeps a single coordinate
  space, so the animated cursor overlay and real clicks stay aligned with the
  zoomed layout — the CSS approach split the coordinate space and drifted by the
  zoom factor. No API change: same `pageZoom` config.

### Fixed

- **pageZoom cursor drift.** The animated cursor overlay was thrown off target by
  the zoom factor under page zoom; it now tracks its target. (Real clicks, which
  used raw CDP coords, were unaffected.)
- **`select()` inside an iframe.** A `<select>` in a dialog iframe was missed —
  `select()` acted on a hidden same-id decoy in the main frame, so
  `:option-index` threw "no matching option" and a literal value silently
  no-opped. It now resolves and acts in the element's own frame.
- **`language` config under headless.** `--lang` only set the Chromium UI
  language, leaving `navigator.language` at the system locale. Added
  `--accept-lang` so the documented two-layer behaviour
  (`navigator.language`/`languages` + the `Accept-Language` header) actually
  holds.
- **Smooth-scroll runtime crash.** Container and window smooth-scroll threw
  `FRAME_MS is not defined` — a constant name leaked into a browser-context
  closure during internal cleanup; the frame interval is now passed in correctly.

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

[Unreleased]: https://github.com/paragramagency/recordable/compare/v0.10.0...HEAD
[0.10.0]: https://github.com/paragramagency/recordable/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/paragramagency/recordable/compare/v0.8.1...v0.9.0
[0.8.1]: https://github.com/paragramagency/recordable/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/paragramagency/recordable/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/paragramagency/recordable/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/paragramagency/recordable/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/paragramagency/recordable/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/paragramagency/recordable/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/paragramagency/recordable/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/paragramagency/recordable/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/paragramagency/recordable/releases/tag/v0.1.0
