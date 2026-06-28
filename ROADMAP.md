# Roadmap

Ordered by quickest win first (ascending effort). The in-house recorder (CDP screencast →
ffmpeg → per-segment MP4 → concat) is the foundation the rest builds on.

## Next

### 1. Audio layers (background music, manual overlays)

`audio` is currently a single overlay (`path`, `wait`, `volume`). Support **multiple
layers** mixed into the final video — e.g. background music under the whole recording, plus
manually-authored voiceover files dropped in by path. These don't need to join the
automatic narration-timing system yet, but must work in the programmatic method chain
(and ideally JSON/Markdown). Implies the mix step (`compose/mix.ts` `addAudio`) mixes N
tracks (per-layer volume, loop/trim-to-length for music, start offsets) rather than one.

### 2. Variables system

A variables system for scripts — defined via `.env` and/or a dedicated variables file —
so values (URLs, credentials, names, etc.) can be referenced and reused across a script
rather than hard-coded inline. Decide on `.env` vs. a separate variables file (or both)
and the reference syntax; works across JSON/Markdown/programmatic. Builds on the `.env`
loading shipped with default-config (see Done).

### 3. Voiceover polish

- **Narration-text auto-detection** — infer voiceover from prose alone, dropping even the
  `voiceover: true` flag.
- **On-screen captions** rendered from the same narration + alignment.

### 4. AI authoring

Mostly "great docs + clean formats" (an AI emits the JSON/Markdown). Optional later:
**record-mode codegen** — watch a human click through once, emit the script — as a more
reliable alternative to LLM-from-scratch.

### 5. Demo-ready product

The showcase (`08-showcase`) covers the headline flow. Remaining is general polish: more
demos, tightening rough edges so the whole thing is presentable.

## Done

### Horizontal container scrolling (merged, unreleased)

`scroll` gained an `axis: "x" | "y"` option and `"left"`/`"right"` keywords (which infer
x). A number or selector takes `axis: "x"` to scroll horizontally; keywords infer the
axis. Generalised `smoothScroll`/`smoothScrollToTarget` over `scrollLeft`/`scrollWidth`
(`src/browser/dom.ts`); auto-scroll-into-view stays vertical. Covered by
`test/e2e/horizontal-scroll.e2e.ts` + manifest unit tests.

### Env file for default configuration (merged, unreleased)

`.env` beside the document now defaults **any** config option as `DEFAULT_<UPPER_SNAKE>`
(`DEFAULT_FPS`, `DEFAULT_VIEWPORT=1920x1080`, `DEFAULT_LAUNCH_ARGS=...`), coerced to each
field's type (`src/env.ts`). Loaded once at config time; precedence defaults → env →
frontmatter → explicit/CLI. Voiceover vars renamed `RECORDABLE_*` → `DEFAULT_*` (secrets
like `ELEVENLABS_API_KEY` keep their provider name). `.env.example` documents the set.

### Include other markdown scripts (merged, unreleased)

`include("./login.md")` — a standalone fenced line or paragraph — splices another script's
steps + narration in at that point, resolving against its own folder (nested includes
supported; cycles caught). The included file's frontmatter is ignored; the top-level
document's config wins (`src/formats/markdown/parse.ts`).

### Richer selectors

Targets pass through to Puppeteer, so nested CSS, combinators, and `nth-*` / sibling
selectors work, plus a composable `:text()` pseudo, `:option-index()` / `:option-label()`
for `select()`, `:has()`, and shadow-DOM piercing (`>>>`). All covered by unit + e2e
tests (`src/browser/targets.ts`, `test/targets.test.ts`, `test/e2e/targets.e2e.ts`). Only
known gap: `:text()` can't match text containing a literal `)`.

### Auto-remove navigation time from clips — `trimNavigation` (merged, unreleased)

Strips the dead time a page spends loading/navigating out of the recorded clip, so the
output cuts straight from action to result, and makes narration timing deterministic by
turning page-load duration into a fixed cut. Generalises `followNewTab`'s off-camera trim
to same-tab `visit(url)` and `waitForNav` clicks via auto pause/resume around any
navigation wait. Enabled by default; works across JSON/Markdown/programmatic. (#11)

### Recording control: `start` / `end` / `split` (0.5.0)

Explicit recording bookends and multi-file output on a two-axis model:
`pause`/`resume` carve off-camera gaps _within_ one file; `start`/`end`/`split` move the
file boundaries to emit _separate_ files. Boundaries default to the script edges (a plain
script is still one file), audio is per-file (zero-based), and `run()` resolves to a
`RecordableResult` (files/paths/timing/warnings) or throws on a hard/incomplete run. Works
programmatically and in JSON/Markdown. See the README "Multiple output files" section.

## Code quality

- **General code cleanup and reorganization** (ongoing).
- **Proper, thorough error handling** throughout — the obvious paths now surface errors
  (logging, play-button injection, step validation with `cause`); a deliberate sweep of
  the rest is still worth doing.

## Cleanup / tech debt

- **Demos are tracked** (in `demos/`); only the generated artifacts — the output MP4s and any
  audio — are gitignored (`demos/**/assets/`). Add better demos later. Flattened from the old
  `examples/` + `examples/demos/` split into a single numbered `demos/` folder
