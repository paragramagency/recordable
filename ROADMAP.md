# Roadmap

Ordered by dependency and risk. The in-house recorder (CDP screencast → ffmpeg →
per-segment MP4 → concat) is the foundation the rest builds on.

## Done

- **In-house recorder.** Replaced `puppeteer-screen-recorder` (which hard-pinned
  `puppeteer@19` and broke `npm install`) with capture via CDP `Page.startScreencast`
  piped to the bundled ffmpeg. Removed the peer-dependency conflict — install is clean,
  no `--legacy-peer-deps` needed.
- **pause / resume / resumeOnInput.** One universal `pause()` (camera off, the chain
  keeps running off-camera); two resumes — programmatic `resume()` and
  `resumeOnInput()`, which waits for an in-page ▶ Play button (or Enter). No
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
  chain. A single typed manifest in `src/script.ts` is the source of truth: it drives
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
- **`select` redesigned.** Single value (the variadic/`multiple` system is gone, incl. the
  manifest `rest` machinery); the cursor now animates to the control like `click`. (Native
  `<select>` option lists are OS-drawn and can't be captured — documented; build custom
  dropdowns from `click`s for on-camera menus.)

## Bugs

- **`resumeOnInput()` — in-page ▶ Play button may not render.** _Hardened (this
  session):_ added a **terminal Enter fallback** (press Enter in the shell to resume,
  works even if the button never renders), wired up the documented **Enter/Space**
  key handling in the injected button, and stopped swallowing injection errors (they
  now log a warning). Still **needs a real headful browser to confirm** whether the
  on-page button itself now renders — couldn't verify in the sandbox.

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
(and ideally JSON/Markdown). Implies the audio layer (`audio/mix.ts` `addAudio`) mixes N
tracks (per-layer volume, loop/trim-to-length for music, start offsets) rather than one.

### 4. AI authoring

Mostly "great docs + clean formats" (an AI emits the JSON/Markdown). Optional later:
**record-mode codegen** — watch a human click through once, emit the script — as a more
reliable alternative to LLM-from-scratch.

### 5. Demo-ready product

The showcase (`08-showcase`) covers the headline flow. Remaining is general polish: more
demos, tightening rough edges so the whole thing is presentable.

## Code quality

- **General code cleanup and reorganization** (ongoing).
- **Proper, thorough error handling** throughout — the obvious paths now surface errors
  (logging, play-button injection, step validation with `cause`); a deliberate sweep of
  the rest is still worth doing.

## Cleanup / tech debt

- **Commit the in-house-recorder work + this session's feature set** (uncommitted on
  `main`). Confirm before pushing to `main`.
- **Demos are tracked** (in `demos/`); only the generated artifacts — the output MP4s and any
  audio — are gitignored (`demos/**/assets/`). Add better demos later. Flattened from the old
  `examples/` + `examples/demos/` split into a single numbered `demos/` folder (plus
  `real-world-edtech.ts`, the one live-site script).
