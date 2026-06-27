# Roadmap

Ordered by dependency and risk. The in-house recorder (CDP screencast → ffmpeg →
per-segment MP4 → concat) is the foundation the rest builds on.

## Done

- **In-house recorder.** Replaced `puppeteer-screen-recorder` (which hard-pinned
  `puppeteer@19` and broke `npm install`) with capture via CDP `Page.startScreencast`
  piped to the bundled ffmpeg. Removed the peer-dependency conflict — install is clean,
  no `--legacy-peer-deps` needed.
- **pause / resume / resumeOnPlay.** One universal `pause()` (camera off, the chain
  keeps running off-camera); two resumes — programmatic `resume()` and
  `resumeOnPlay()` (was `resumeOnInput`), which waits for an in-page ▶ Play button (or Enter). No
  `start()`/`stop()`: recording is on by default and finalises on `.run()`. Captured
  stretches become segments, stitched into one seamless MP4.
- **Insert / external video (intros, outros, mid-rolls), with cross-fades.**
  `.insert(path, { fadeIn, fadeOut })` ends the current segment, normalizes the external
  clip to the recording's resolution / fps / codec / pixel format (letterbox-fit, audio
  dropped), and appends it — first = intro, last = outro, mid-chain = mid-roll.
  Auto-segments: no pause/resume needed, recording resumes on the next action. Without
  fades the join stays a lossless concat stream-copy; `fadeIn`/`fadeOut` (ms) defer
  assembly to a `filter_complex` that `xfade`s the clip with the neighbouring footage
  (or fades from/to black at the timeline ends).
- **Declarative JSON format + schema + CLI.** Scripts can be authored as JSON — an
  array of flat `{ action, ... }` steps (or `{ config, steps }`) mapping ~1:1 to the
  chain. A single typed manifest in `src/actions.ts` is the source of truth: it drives
  the interpreter (`fromJSON` / `runScript`) and generates the published
  `recordable.schema.json` (`npm run gen:schema`), which gives editor autocomplete +
  required/typo checking via a `$schema` reference — no TypeScript needed. Run via
  `npx recordable demo.json` (the `recordable` bin), with `--check` to validate without
  a browser. Methods keep positional essentials + a trailing options bag for expansion.
- **Markdown authoring + timing-driven voiceover.** Narration prose with inline backtick
  markers compiles to a timed core script (ElevenLabs TTS + per-word alignment → computed
  waits). Provider/voice/model default from `RECORDABLE_TTS_PROVIDER` / `RECORDABLE_VOICE_ID`
  / `RECORDABLE_MODEL_ID`, so a document opts in with just `voiceover: true` (frontmatter
  overrides). `insert` now takes `fadeIn`/`fadeOut` in JSON/markdown too, and `insert`/`audio`
  paths resolve against `baseDir`.
- **Showcase demo (`08-showcase`).** Finished-product walkthrough — narrated `demo.md`
  (sign in → evaluation → mark → audit → export) bookended by branded intro/outro cards
  baked from the bundled ffmpeg (`make-cards.mjs`).
- **Tooling: Prettier + ESLint** (flat config, npm scripts, CI steps) applied across the
  codebase. **Logging** is a level-aware `[Recordable]`-prefixed logger (info/warn/error,
  honours `silent`; errors always surface). **`launchArgs`** config passes extra Chromium
  flags (`--no-sandbox`, …).
- **Explicit click navigation waits.** Dropped the best-effort post-click navigation probe
  (a 200ms race that missed slow commits and could stall on a busy page). `click()` is now
  instantaneous by default; `click(target, { waitForNav: true })` deterministically waits
  for a full-page navigation — the wait is armed _before_ the click (no probe race), the
  navigation must land, and the network settles best-effort, so it behaves like `visit()`.
  SPA route changes / async content are gated with a following `waitFor(...)`.
- **`select` redesigned.** Single value (the variadic/`multiple` system is gone, incl. the
  manifest `rest` machinery); the cursor now animates to the control like `click`. (Native
  `<select>` option lists are OS-drawn and can't be captured — documented; build custom
  dropdowns from `click`s for on-camera menus.)
- **Browser language.** A `language` config (BCP-47 tag, e.g. `"fr-FR"`) sets the Chromium
  UI / `navigator.language` via `--lang` and the `Accept-Language` request header, so demos
  render and content-negotiate in a chosen locale. Empty (default) leaves the system locale.
- **New-tab recording.** `click(target, { followNewTab: true })` follows a link that opens
  in a new tab and continues recording there: the runtime arms `page.once("popup")` before
  the click, seals the current segment, sets up the new tab (viewport, cursor re-inject),
  waits for it to load off-camera, and switches capture to it (old tab left open). The
  recorder re-creates its per-target CDP session for the new page; the single-tab path still
  reuses the cached one. Schema-driven, so JSON/Markdown get it for free. Spec in
  [specs/new-tab-recording.md](specs/new-tab-recording.md). (was Next #5)
- **Composable `:text()` + `select` option pseudos.** Inner-text matching composes with full
  CSS anywhere in a selector (`button:text(Save)`, `tr:nth-child(3) td:text(Done)`; legacy
  `text:` prefix kept as an alias), and the runtime warns when a target matches >1 element
  (acts on the first). `select(target, value)` also takes `:option-index(N)` (1-based) /
  `:option-label(Text)` to pick a `<select>` option without its raw `value`.
- **`pageZoom` config.** Browser-level page zoom via `evaluateOnNewDocument`, so `pageZoom < 1`
  reflows layout to fit more on screen; persists across navigations and new tabs, and the
  cursor overlay tracks it.
- **Test suite + CI.** `npm test` now gates CI: unit (pure logic), I/O (real bundled ffmpeg
  via fixtures), and an opt-in end-to-end pipeline run (`npm run test:e2e`).

## Bugs

_None open._ Recently resolved (confirmed against the real login flow in a headful browser):

- **`resumeOnPlay()` (was `resumeOnInput`) — in-page ▶ Play button.** Hardened with a
  terminal Enter fallback, Enter/Space handling on the button, and surfaced injection
  errors (no longer swallowed). Login flow verified working end-to-end.
- **Cursor not visible during the manual ▶ Play step.** Root cause was the `* { cursor:
none !important }` rule the overlay injected to hide the real pointer — but the screencast
  never captures the OS cursor, so it did nothing for the video and only blanked the live
  headful pointer (the cursor "showed sometimes" purely by accident when a navigation
  dropped the rule). Dropped `cursor: none` entirely. Also made `resume()` restore the
  cursor to its `pause()` position so a resumed segment opens where the previous one ended.

## Next

> The original keystones (JSON format, Markdown authoring, timing-driven voiceover) have
> shipped — see Done. Design notes live in [VOICEOVER.md](VOICEOVER.md). What's left:

### 1. Voiceover polish

- **Narration-text auto-detection** — infer voiceover from prose alone, dropping even the
  `voiceover: true` flag.
- **On-screen captions** rendered from the same narration + alignment.

### 2. Env file for default configuration

Today `.env` is loaded only on the voiceover path (ElevenLabs secrets + `RECORDABLE_*`
voice/provider/model defaults, read from a `.env` beside the document). Broaden it into a
general default-configuration file so non-voiceover config (e.g. resolution, fps, output
paths, `launchArgs`) can also be defaulted from env, with frontmatter / explicit config
still overriding. Document the full set of recognised keys (extend `.env.example`).

### 3. Audio layers (background music, manual overlays)

`audio` is currently a single overlay (`path`, `wait`, `volume`). Support **multiple
layers** mixed into the final video — e.g. background music under the whole recording, plus
manually-authored voiceover files dropped in by path. These don't need to join the
automatic narration-timing system yet, but must work in the programmatic method chain
(and ideally JSON/Markdown). Implies the mix step (`compose/mix.ts` `addAudio`) mixes N
tracks (per-layer volume, loop/trim-to-length for music, start offsets) rather than one.

### 4. AI authoring

Mostly "great docs + clean formats" (an AI emits the JSON/Markdown). Optional later:
**record-mode codegen** — watch a human click through once, emit the script — as a more
reliable alternative to LLM-from-scratch.

### 5. ~~New-tab recording~~ — Done

Shipped — see Done. `click(target, { followNewTab: true })` continues recording in a
tab the click opens, stitched seamlessly into the same output; old tab left open, new
tab's loading trimmed. Design + decisions in
[specs/new-tab-recording.md](specs/new-tab-recording.md).

### 6. API additions

- **Reintroduce `.start()`** — a wrapper around `pause`/`resume` for explicit
  start-of-recording control.
- **`.split()`** — split the output into multiple video files.
- ~~**Rename `resumeOnInput`**~~ _Done (this session):_ `resumeOnInput()` →
  `resumeOnPlay()`, with the gate split into a standalone `waitForPlay()`
  (`resumeOnPlay()` = `waitForPlay().resume()`).

### 7. Richer selectors

_Largely done:_ targets pass through to Puppeteer, so nested CSS, combinators, and
`nth-*` / sibling selectors work, plus a composable `:text()` pseudo and `select`
option pseudos (see Done). Remaining is any matching gap real-world DOMs surface.

### 8. ~~Ignore markdown comments~~ — Done

Whole-line `//` comments (the syntax VS Code injects on toggle-comment) are stripped from
the markdown body before tokenising, so an author note never compiles into narration the
TTS reads or into a step. Only a line whose first non-whitespace is `//` is dropped (incl.
its newline, so a note inside a paragraph doesn't split it); `//` mid-line — e.g. in
`https://…` — is left untouched, and a `//` line inside a fenced action list comments that
step out. (Chose `//` over HTML `<!-- -->` for the friendlier editor affordance.)

### 9. Variables system

A variables system for scripts — defined via `.env` and/or a dedicated variables file —
so values (URLs, credentials, names, etc.) can be referenced and reused across a script
rather than hard-coded inline. Decide on `.env` vs. a separate variables file (or both)
and the reference syntax; works across JSON/Markdown/programmatic.

### 10. Include other markdown scripts

Let a markdown script pull in another, e.g. `.include("./login.md")`, so common flows
(sign-in, setup) live in one reusable file and compose into larger demos. Resolve paths
against `baseDir`; merge narration/steps inline at the include point.

### 11. Demo-ready product

The showcase (`08-showcase`) covers the headline flow. Remaining is general polish: more
demos, tightening rough edges so the whole thing is presentable.

## Code quality

- **General code cleanup and reorganization** (ongoing).
- **Proper, thorough error handling** throughout — the obvious paths now surface errors
  (logging, play-button injection, step validation with `cause`); a deliberate sweep of
  the rest is still worth doing.

## Cleanup / tech debt

- ~~**Commit the in-house-recorder work + this session's feature set**~~ _Done — committed
  on `main`; released as v0.3.0._
- **Demos are tracked** (in `demos/`); only the generated artifacts — the output MP4s and any
  audio — are gitignored (`demos/**/assets/`). Add better demos later. Flattened from the old
  `examples/` + `examples/demos/` split into a single numbered `demos/` folder
