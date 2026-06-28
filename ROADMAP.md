# Roadmap

Ordered by dependency and risk. The in-house recorder (CDP screencast → ffmpeg →
per-segment MP4 → concat) is the foundation the rest builds on.

## Next

### 1. Voiceover polish

- **Narration-text auto-detection** — infer voiceover from prose alone, dropping even the
  `voiceover: true` flag.
- **On-screen captions** rendered from the same narration + alignment.

### 2. Auto-remove navigation time from clips

Strip the dead time a page spends loading/navigating out of the recorded clip, so the
output cuts straight from action to result. Beyond tightening the video, this makes
**narration timing deterministic**: page-load duration is currently an unknown that the
alignment system has to absorb, and removing it turns that variable into a fixed cut.
Expose as an option (`trimNavigation`?) that can be enabled or disabled, **enabled by
default**. Works across JSON/Markdown/programmatic.

Prior art: new-tab clicks already trim their load off-camera via `followNewTab`
(`session.ts` `_switchTab`, pause/seal/resume on the new page). This generalises that to
the common case it doesn't cover — same-tab `visit(url)` and `waitForNav` clicks, whose
page loads are currently captured on-camera and stay in the clip. Effectively: auto
pause/resume around any navigation wait, reusing the existing segment trim.

### 3. Env file for default configuration

Today `.env` is loaded only on the voiceover path (ElevenLabs secrets + `RECORDABLE_*`
voice/provider/model defaults, read from a `.env` beside the document). Broaden it into a
general default-configuration file so non-voiceover config (e.g. resolution, fps, output
paths, `launchArgs`) can also be defaulted from env, with frontmatter / explicit config
still overriding. Document the full set of recognised keys (extend `.env.example`).

### 4. Audio layers (background music, manual overlays)

`audio` is currently a single overlay (`path`, `wait`, `volume`). Support **multiple
layers** mixed into the final video — e.g. background music under the whole recording, plus
manually-authored voiceover files dropped in by path. These don't need to join the
automatic narration-timing system yet, but must work in the programmatic method chain
(and ideally JSON/Markdown). Implies the mix step (`compose/mix.ts` `addAudio`) mixes N
tracks (per-layer volume, loop/trim-to-length for music, start offsets) rather than one.

### 5. AI authoring

Mostly "great docs + clean formats" (an AI emits the JSON/Markdown). Optional later:
**record-mode codegen** — watch a human click through once, emit the script — as a more
reliable alternative to LLM-from-scratch.

### 6. ~~Recording control: `start` / `end` / `split`~~ — Done

Shipped in 0.5.0 — see [Done](#done).

### 7. Richer selectors

_Largely done:_ targets pass through to Puppeteer, so nested CSS, combinators, and
`nth-*` / sibling selectors work, plus a composable `:text()` pseudo and `select`
option pseudos. Remaining is any matching gap real-world DOMs surface.

### 8. Variables system

A variables system for scripts — defined via `.env` and/or a dedicated variables file —
so values (URLs, credentials, names, etc.) can be referenced and reused across a script
rather than hard-coded inline. Decide on `.env` vs. a separate variables file (or both)
and the reference syntax; works across JSON/Markdown/programmatic.

### 9. Include other markdown scripts

Let a markdown script pull in another, e.g. `.include("./login.md")`, so common flows
(sign-in, setup) live in one reusable file and compose into larger demos. Resolve paths
against `baseDir`; merge narration/steps inline at the include point.

### 10. Horizontal container scrolling

Vertical container scrolling shipped; horizontal scrolling within an overflow pane is
the remaining nice-to-have.

### 11. Demo-ready product

The showcase (`08-showcase`) covers the headline flow. Remaining is general polish: more
demos, tightening rough edges so the whole thing is presentable.

## Done

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
