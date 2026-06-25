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

## Next

### 1. Declarative Markdown format

The JSON half of the original keystone is done (above). Remaining: **Markdown** as the
authoring surface.

- Narration prose with **inline action markers** in a small custom syntax, e.g.
  `Welcome. {{click "text:Start"}} Let's name it {{type "#title" "My model"}}.`
  The markers reuse the JSON action manifest, so the marker parser maps onto the same
  source of truth (positional args in the marker, mapped via the manifest).
- Markdown is narration-spine-with-actions, **not** a flat action list — designed this
  way so it doubles as the voiceover script (see #2).
- **AI writes the scripts.** With the JSON schema + docs already shipped, this is mostly
  "clean formats an AI (or person) produces trivially," now extended to Markdown. A small
  docs/schema MCP server is a possible later nicety (likely overkill).

### 2. Voiceover (ElevenLabs, timing-driven)

> **Design plan: [VOICEOVER.md](VOICEOVER.md)** — full architecture for this item
> (compiles to existing primitives; core/add-on boundary; CLI & credentials). The
> notes below are the original sketch.

Timing is the hard part. Audio-first:

- Generate each narration line's TTS up front and request **per-character/word
  alignment** (ElevenLabs supports this) — not just the total duration.
- Schedule actions at word-level offsets *within* a line, so narration and actions run
  **concurrently** — not a strict voice → action → voice pattern. The video timeline
  follows the audio; insert waits to fill gaps so lengths match. ffmpeg muxes the
  concatenated audio onto the video track.
- The Markdown inline-action syntax (#1) is the natural authoring surface: marker text
  position → word alignment → fire time.
- Needs a **TTS provider abstraction** (ElevenLabs first; API key via config/env), and
  pairs naturally with on-screen captions.
- **Open decision:** confirm audio-leads-video (recommended — perfect sync, video waits)
  vs placing clips onto a finished-video timeline.

### 3. AI authoring

Folds into #1 — "great docs + clean formats," not a separate tool. Optional later:
**record-mode codegen** (watch a human click through once, emit the JSON script) as a
more reliable alternative to LLM-from-scratch.

## Cleanup / tech debt

- **`aspectRatio` config is now unused** (the old recorder consumed it). Removed from the
  README; still in `RecordableConfig` — either delete it or implement via an ffmpeg
  filter.
- **Expose Puppeteer launch args** (e.g. `launchArgs` / `puppeteerOptions`) so
  `--no-sandbox` etc. can be passed — needed for some headless / CI / sandbox envs.
- **Commit the in-house-recorder work + this session's feature set** (currently
  uncommitted on `main`); fold in the pending README lint tweak. Confirm before pushing
  to `main`.
- **Demos are intentionally untracked** (kept locally in `demos/`, excluded from the repo)
  — add better ones later. Flattened from the old `examples/` + `examples/demos/` split into
  a single numbered `demos/` folder (plus `real-world-edtech.ts`, the one live-site script).
  There's a throwaway `verify-capture.ts` in the root for smoke-testing capture; delete once
  happy.
