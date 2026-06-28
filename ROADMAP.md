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

### 6. Recording control: `start` / `end` / `split`

Add explicit recording bookends and multi-file output, on a **two-axis model** that keeps
them distinct from `pause`/`resume` (no duplicate functionality under new names):

- **Off-camera gaps (within one file):** `pause()` stops the camera, `resume()` continues
  it into the _same_ output file — the gap is stitched out, the clip stays continuous.
  (Unchanged.)
- **File boundaries (which file):** `start()` opens an output file, `end()` closes it,
  `split()` does both at once. These produce _separate_ files.

They share the segment plumbing; the only mechanical difference is where the next segment
goes — `resume()` appends to the current file, `start()`/`split()` open a new one. So
`resume`≠`start` and `pause`≠`end`.

**Boundaries default to the script edges.** `start()` relocates the opening boundary
(content before it is off-camera); absent, it sits at the top. `end()` relocates the
closing boundary (content after is off-camera); absent, at the bottom. A simple script
needs neither — it records top-to-bottom as today; add only the bookend you actually need.
`split() ≡ end() + start()` fused with no gap (camera keeps rolling, output switches
files); put off-camera work _between_ an `end()` and the next `start()` to get two files
with a gap instead. **Pause never crosses a boundary** — `split()` always starts a fresh,
rolling file.

**Naming:** `${outputName}-${label ?? index}.mp4`. `start`/`split` take an optional `name`
label (`split("checkout")`); unlabeled files fall back to 1-based position; a run-wide
timestamp (when enabled) is shared across all files. **A label always wins** — a single
file produced by a labelled `start("intro")` is `${outputName}-intro.mp4`; the bare
`${outputName}.mp4` fallback applies only when there are _no_ labels and _no_ splits.
**No concatenated master** — splitting means you want separate files.

**Audio is per-file** — each output is a standalone deliverable with its own zero-based
timeline. A clip is assigned to the file containing its start; one overrunning a `split` is
trimmed to its file, with a warning. (Folds into the audio-layers work, #4.)

**State machine / validation** — at any point either no file is open (off-camera) or one
is (capturing or paused):

- `start()` while already recording → **error** (use `split()`/`end()` first).
- A `start()` with no matching `end()` → **implicit end at the bottom** (symmetric with an
  absent `start` meaning top): the file stays open to the script's end, no warning.
- `end()` / `split()` / `pause()` / `resume()` with no open file → **error**.
- `insert()` requires an open file (it's an on-camera segment) → **error** in a gap.
- Redundant `pause()`/`resume()` → **no-op**.
- Empty file (`start`→`end` with no captured frames) → **skipped**, warned.
- `split()`/`end()` while paused → allowed (seal as-is; the new file rolls).
- Trailing actions after the last `end()` → run off-camera, **no warning** (cleanup is
  common).

**`run()` returns a `RecordableResult`** and logs a clean completion summary listing each
file:

```ts
{ status: "completed" | "empty";   // "empty" = nothing captured
  files: Array<{ path: string; label: string | null; index: number;
                 durationMs: number; bytes: number }>;
  outputDir: string; durationMs: number; elapsedMs: number; warnings: string[] }
```

Hard failures — browser/ffmpeg, or a script that can't run to completion — still **throw**
`RecordableError`; the result is the success path only, so `files` is always real (no
two-ways-to-fail). `run()` is `void` today, so this is additive.

**Formats:** new actions `start`/`split` (`{ name? }`) and `end` (`{}`) in the `ACTIONS`
manifest, surfaced as backtick method markers in Markdown (`name` positional-optional like
`waitForPlay`'s `message`). Programmatic chain first, then JSON/Markdown.

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

## Code quality

- **General code cleanup and reorganization** (ongoing).
- **Proper, thorough error handling** throughout — the obvious paths now surface errors
  (logging, play-button injection, step validation with `cause`); a deliberate sweep of
  the rest is still worth doing.

## Cleanup / tech debt

- **Demos are tracked** (in `demos/`); only the generated artifacts — the output MP4s and any
  audio — are gitignored (`demos/**/assets/`). Add better demos later. Flattened from the old
  `examples/` + `examples/demos/` split into a single numbered `demos/` folder
