# Voiceover — design plan

Roadmap #2. Planning only; implement later. Builds on the JSON layer (`actions.ts`,
done) and the Markdown parser (#1, in progress — preserves marker char-offsets).

## Guiding principle: compile down, don't add a system

Voiceover is **not** a parallel scheduler bolted onto the recorder. It is a
**wrapper that compiles to the existing chained primitives**. A narration block
becomes nothing more than:

```
audio("block-0.mp3", { wait: false })   // start the clip, don't block the chain
wait(1400)                               // computed gaps carry the timing
type("#title", "My model", { duration: 4000 })
wait(2000)
```

The runtime stays dumb: it plays/places audio and runs actions in sequence. All
the cleverness (TTS, word alignment → wait math) happens at **compile time** and
emits plain steps. This keeps the runtime deterministic and the provider swappable.

Three layers, decoupled:

- **A. Runtime primitive** — `audio()` + recorder mux + deterministic `type`. Generic; no TTS knowledge.
- **B. TTS adapter** — pure `text → audio + alignment`. ElevenLabs first. Cached.
- **C. Compiler** — narration + markers + alignment → a timed chain of A's primitives, using B.

## Package boundary: core vs add-on (one-way dependency)

TTS / audio _generation_ is an **extra feature, not core**. Draw the line so **core
never imports voiceover; voiceover imports core.** That one rule isolates the network
dependency and makes a later package split nearly free.

- **Core (`recordable`)** — `Recordable`, the `audio()` primitive + mux, deterministic
  `type`, the JSON parser, **the markdown parser** (markers + frontmatter → steps), and
  the CLI. **Zero network, no ElevenLabs.**
- **Voiceover add-on (`recordable/voiceover`, optional dep)** — the TTS adapter (B) + the
  compile step (C) that synthesizes narration → audio files and computes waits from
  alignment. Its _output is a plain core script_ (`audio()`/`wait()`/action steps), so the
  add-on only ever produces core artifacts.

Consequences:

- **`audio()` is core, not voiceover** — it plays an _existing_ file (your own mp3, no
  TTS). Only _generating_ the audio is the add-on.
- **The markdown parser is core; only TTS+timing is the add-on.** So **narrative-free
  markdown** (markers, no prose) compiles through the _core_ parser to plain steps — no
  audio, no network. Narration is the only thing that pulls in the add-on. (JSON is
  usually the better choice there, but it works under the hood for free.)

## Programmatic API (CLI is sugar on top)

Everything is library functions; the CLI just orchestrates parse → (compile) → run.

- `recordable` exports: `Recordable`, `fromJSON`, `runScript`, `fromMarkdown`,
  `parseMarkdown`, `ACTIONS`, `buildSchema`.
- `recordable/voiceover` exports: `compileMarkdown`, `TTSProvider`, `ElevenLabsProvider`.

`compileMarkdown(md, cfg)` is directly callable for programmatic markdown runs.

## The manual/auto asymmetry (where auto-timing lives)

The split is deliberate and is the core of the design:

- **JSON / method chain = low-level.** You write the `wait`s yourself. `audio()` just
  places an existing file. No magic, fully explicit.
- **Markdown = authoring surface.** You **don't write waits, you write words.** Prose
  length between markers _is_ the timing language. A **compile step** (Layer C) generates
  the audio and turns word positions into concrete `wait`s.

Auto-timing therefore lives entirely in **one place**: the `markdown → JSON` compiler.
Its output is a _normal script_ (`steps[]` with computed waits + `audio()` calls) plus a
folder of generated audio assets. So:

- The compiled artifact re-runs **offline, deterministically, with zero TTS calls** — even commitable.
- The computed waits are **inspectable** (you see what the compiler decided).
- The runtime gets **no special path** — it only ever sees primitives. The audio-generation
  step lives at compile time, cached.

`compileMarkdown(md, cfg) → { script, assets }` is the real step; `fromMarkdown` =
compile-then-run sugar. A silent beat (pause with no narration) is just an explicit
`{{wait 2000}}` marker — free, since `wait` is already in the manifest.

---

## A. Runtime: `audio()` primitive

A new generic chain method (sits beside `insert`, `wait`). Not voiceover-specific —
it just lays an audio file onto the recording timeline.

```ts
audio(path: string, opts?: { wait?: boolean; volume?: number }): this
```

- **`wait` (default `true`)** — block the chain until the clip finishes (implicit
  `wait(durationMs)`). Opt out with `{ wait: false }` for the voiceover case, where
  the clip plays _over_ subsequent interleaved actions.
- Audio is **not** literally sounded during capture (recording is silent frames,
  often headless). `audio()` records `{ path, startMs }` where `startMs` is the
  clip's position on the final timeline; the recorder **muxes it in at finalise**.

### Recorder changes

- Track a **timeline clock**: `startMs = (sum of finalised segment durations) +
(frames in current segment / fps × 1000)` at the moment `audio()` runs. Store
  `{ path, startMs }` in an `audioTrack[]`.
- New final **mux** step after concat: for each entry `adelay=startMs` → `amix`
  all clips → mux onto the silent video with `-c:v copy`. (Reuses `runFfmpeg`.)
- **Tail handling:** if the last clip runs past video end (non-blocking + no trailing
  `wait`), pad the video by freezing the last frame so narration isn't cut. _(decision — see below)_
- Pause edge case: pausing mid-clip drops off-camera time the audio assumes. Document
  as "don't `pause()` inside a narration block."

### Deterministic `type` (the timing enabler) — IMPLEMENTED

The compiler must predict each action's duration to lay out waits. Most actions are
already deterministic (`scroll`/`zoom` take an explicit `duration`; `click`/`key` are
~fixed). The outlier was human-jittered `type`. **Resolved (implemented):** `type` is
now jittered _and_ deterministic in total — the jitter is **zero-sum**, redistributing
time within a fixed budget rather than changing it.

```ts
type(target, text, { duration?: number }): this
```

- **Total budget** = `typingDuration(text, speed)` = `round(text.length / speed × 1000)`
  (`src/utils.ts`). A pure function of the text — the compiler estimates against the
  _same_ function (`stepDurationMs` in `compile.ts` imports it), so predicted == actual.
- **Jitter** (`typingGaps`) draws seeded per-key weights (punctuation heavier, a lead
  beat), then **normalises them back onto the budget** so the delays always sum to the
  total. Seeded by `hashString(text)` (mulberry32) → same text types with the same rhythm
  every run, so recordings stay reproducible. No more no-jitter robotic branch.
- **`{ duration }` overrides the total** (e.g. fill a narration window); jitter is
  redistributed within it. Omitted → the natural per-length budget, the common path.

**This dissolves the typing-duration problem without elastic surgery:** typing is
_always_ deterministic, so the compiler reads `typingDuration(text)` to lay out waits and
only sets `{ duration }` when it deliberately wants a non-natural length. (Decided this
session: omitted duration = the natural budget, same meaning across chain/JSON/markdown —
not a compiler-controlled elastic fit.) Tests: `test/typing.test.ts` (sum-invariant,
reproducibility, structural weighting — all browser-free).

Also: the compiler should run with `actionDelay: 0` (the 300ms inter-action default
would silently desync the timeline) and bake any needed gaps into explicit `wait`s.

---

## B. TTS adapter (pure, cached)

Lives under `src/tts/`. Knows nothing about ffmpeg, the queue, or scheduling —
just `text → audio + timing`. This is the swappable boundary.

```ts
interface TTSProvider {
  synthesize(text: string, opts?: SynthOptions): Promise<TTSResult>;
}
interface TTSResult {
  audio: Buffer; // decoded bytes
  format: string; // e.g. "mp3_44100_128"
  durationMs: number;
  alignment?: Alignment; // optional — degrade gracefully if absent
}
interface Alignment {
  // provider-agnostic, normalised
  chars: string[];
  startMs: number[]; // per character
  endMs: number[];
}
```

**ElevenLabs adapter** maps 1:1 via the JS SDK:
`textToSpeech.convertWithTimestamps(voiceId, { text, model_id, voice_settings, outputFormat })`
→ `{ audio (base64), alignment: { characters, character_start_times_seconds,
character_end_times_seconds } }`. Adapter decodes base64, converts seconds→ms,
normalises into `Alignment`. (5000-char limit per request → one request per block is fine.)

Config (nested, keeps the flat config clean):

```ts
voiceover?: {
  provider: "elevenlabs";
  apiKey?: string;       // else process.env.ELEVENLABS_API_KEY
  voiceId: string;
  modelId?: string;      // default eleven_multilingual_v2
  voiceSettings?: { stability?: number; similarityBoost?: number; ... };
  format?: string;
};
```

### What the provider returns (ElevenLabs, verified)

`convertWithTimestamps` → one JSON response: `audio` (base64) + `alignment`
(per-**character** arrays: char, start, end). Audio is encoded as `outputFormat`,
**default `mp3_44100_128`**. Higher MP3/PCM/Opus rates exist but are tier-gated; the
default works on every plan. 5000-char limit per request. Raw REST gives seconds; the
adapter normalises to ms.

**Format decision: keep the `mp3_44100_128` default, store `.mp3`.** We re-encode to the
final audio track via ffmpeg at mux time, so PCM/lossless only costs disk — the final
encode is the only quality stage that matters.

### Caching (decided)

**It's a timing cache, not just an audio cache.** A hit must return audio **and**
alignment — the compiler needs alignment to compute waits, and that's what makes
"compiled artifact replays offline, zero TTS calls" true.

**Granularity = one narration paragraph = one cache entry = one TTS request.** Edit
paragraph 3 of 8 → only 3 re-synthesizes; the rest are instant hits. A paragraph is well
under the 5000-char limit and is exactly the unit the compiler needs alignment for.

**Entry = two files, one hash, in a gitignored project-local `.recordable-cache/`:**

```
.recordable-cache/
  <hash>.mp3     # decoded audio bytes
  <hash>.json    # { alignment (normalised, ms), durationMs, format, cacheVersion, text }
```

- Store **normalised** alignment (provider-agnostic, ms), not the raw SDK shape — an SDK
  upgrade or a second provider can't break replays of old entries.
- `durationMs` from an **ffprobe of the decoded file**, not the last alignment timestamp
  (mp3 frame padding makes the file slightly longer; the tail-wait / `audio()` placement
  needs the real length).
- `text` is for debug/inspection only — not read on a hit.

**Key** = `hash(provider + voiceId + modelId + JSON(voiceSettings) + outputFormat +
cacheVersion + normalisedStrippedText)`.

- `normalisedStrippedText` = markers removed (inaudible) **and** whitespace collapsed, so
  reflowing prose / re-wrapping a line doesn't bust the cache — only audible content keys it.
- `cacheVersion` = a constant we bump when normalisation or alignment-mapping logic
  changes, so a logic change **misses** instead of silently serving stale timing.

**Operational:** synthesize missing blocks **concurrently (bounded ~4)**; write to a temp
file then **rename** (atomic — a killed run never leaves a corrupt-but-valid-hashing entry).
Log cost per compile (`synthesized 2 blocks (1,240 chars) · 6 cached`) — ElevenLabs bills
per character, so the cache is the cost story. No eviction (content-addressed entries just
accumulate; a `cache clean` is a later nicety). Global cross-project store deferred — the
key is already content-hashed, so a global tier slots in later without changing it.

---

## C. Compiler: narration + markers → timed chain

Reuses the Markdown parser's output (handoff): `{ narration, markers: [{ action,
args[], offset }] }` where `offset` is the marker's char position in the stripped
narration. Per block:

1. **Synthesize** `narration` via the adapter (cache-first) → audio file + `Alignment` + `durationMs`.
2. For each marker at char `offset` → snap to the enclosing **word boundary** →
   `fireMs = alignment.startMs[wordStartChar]`.
3. **Emit the chain**, accounting for action durations so narration words line up
   with action _starts_:

   ```
   emit  audio(file, { wait: false })
   elapsed = 0
   for marker in markers (ordered):
       gap = marker.fireMs - elapsed
       if gap > 0: emit wait(gap); elapsed += gap
       emit marker.step (with deterministic duration d)
       elapsed += d
   if elapsed < durationMs: emit wait(durationMs - elapsed)   // let VO finish
   ```

4. Steps flow through the **existing** `fromJSON`/`buildArgs` path — no new dispatch.

### Timing model (decided)

The compiler does **placement + loud warnings**, never silent timing surgery.

- **Start-on-word, no lead.** A marker's action _starts_ at its word's `fireMs`. Want it
  earlier (a resultative reveal — "here's the result")? Move the marker earlier in the
  prose. Marker position _is_ the timing control. (A per-marker `lead` was rejected: it
  would be a markdown-only concept with no meaning in the chain/JSON surfaces, breaking
  the one-mental-model rule.)

- **Pinned/default, never elastic.** Explicit `duration` is respected exactly. Omitted
  `duration` uses **the default** — the _same_ meaning as in the chain and JSON surfaces
  (not "compiler fits it to the window"). `type()` with no duration runs at default speed.
  The compiler never silently changes a zoom/fade/typing to fit. (A "fit to window" mode,
  if ever wanted, is an explicit per-action opt-in flag — never the default.)

- **Pauses = interleaved fenced blocks.** A fenced action block between two narration
  paragraphs is a **narrative-level wait**: narration stops, its actions run sequentially
  (their durations sum), narration resumes at the next paragraph. This is the explicit
  "let the animation finish however long, while the narrator waits" mechanism — no new
  syntax, just the `07`/`08` surfaces composed. It's also the pressure valve that lets
  actions _inside_ a narration paragraph stay short gestures.

  - **Any fence, language tag ignored.** A code block is a step list regardless of its
    info string — ` ``` `, ` ```ts `, ` ```recordable ` all parse identically. The tag is
    a visual aid for editor highlighting only; the parser never reads it.
  - **One call per line / per span.** Each fenced line holds exactly one call, and each
    inline backtick marker holds exactly one call. This keeps parsing unambiguous (the
    opening paren is the first `(` after the name; the closing paren is the line's last
    character) — put a second action on its own line or its own backticks.

- **Overrun → keep the duration, lag, and warn precisely.** If a pinned action inside a
  paragraph is longer than its narration window, `gap < 0`: the wait is skipped and the
  rest of _that paragraph_ lags its words. The compiler **warns** with specifics (which
  action, by how much, and the three fixes: shorten action / lengthen narration / move it
  into a pause block). It does **not** auto-fix.

- **Cross-block drift self-corrects for free.** `audio()` lays its clip at the current
  queue-clock position, and actions advance that same clock — so each block's audio start
  rides the same clock its actions ride. Within-block overrun lags that block; the **next**
  block's audio is laid at the (drifted) current clock and its waits are computed relative
  to its own audio start, so it re-syncs. **Therefore emit per-block-relative waits**
  (`audio()` then relative `wait`s) — never absolute document-wide times — and drift never
  compounds past a paragraph boundary.

### Entry point

`fromMarkdown(md, config)` becomes **async** when `config.voiceover` is set (TTS is a
network call). Without voiceover config, markers compile to a plain chain as today
(no audio). Likely: `async compileMarkdown(md, cfg) → { steps, audioFiles }` →
`runScript`. The TTS/compile step is the only async-at-build part.

---

## CLI & credentials

The common case is running markdown files via the CLI. Keep the separation in the
**library** (`compileMarkdown` vs `runScript`), not between two processes — one bin,
two modes:

- `recordable <file>` — dispatch by extension. `.json` → run (today). `.md` →
  compile-then-run.
- `recordable compile <file.md> [-o demo.json]` — **compile only**: emit the
  schema-valid JSON script + an audio-assets folder, no recording. `recordable
demo.json` then runs it **offline, with zero TTS calls**.

The `compile` subcommand _is_ the "narrative step that wraps the generator", but
in-process — no subprocess shelling. It also yields the inspectable/cacheable/
commitable artifact, and sidesteps naming a second tool.

**Config carrier for markdown:** YAML **frontmatter** (markdown has no config block
today; JSON has `{ config, steps }`). Holds recording config _and_ the non-secret
voiceover settings:

```md
---
voiceover:
  { provider: elevenlabs, voiceId: "21m00…", modelId: eleven_multilingual_v2 }
cursor: true
---

Welcome to Lumen. {{click "text:Start"}} …
```

**CLI config overrides:** generalize the current flag→config mapping to the common
knobs — `--viewport 1920x1080` (or `--width`/`--height`), `--fps`, `--crf`, alongside
the existing `--headless`/`--out-dir`/etc. Precedence, low → high: **defaults < file
config (frontmatter or JSON `config`) < CLI flags** — the same `{ ...config, ...override }`
pattern `fromJSON` already uses, extended to frontmatter.

**Credentials — env-first, never in the committed file:**

- API key → **`ELEVENLABS_API_KEY`** env var (primary, CI-friendly), with **`.env`
  auto-loaded** from the script's dir (Node `--env-file`, no dep). `--eleven-key`
  flag optional but discouraged (shell-history leak).
- Only the _key_ is secret; provider/voiceId/model live in frontmatter (above).
- **Skip** a global `~/.recordable/credentials` store for now — env + `.env` covers
  the vast majority; add the `gh`-style store later only if cross-project reuse demands.

**Optional dependency:** the ElevenLabs SDK is an `optionalDependency`, dynamically
`import()`ed only in the compile-with-voiceover path. Core record-JSON install stays
lean and never loads it.

## Decisions

1. **`audio()` default** — _decided:_ block until the clip finishes (`wait: true`); opt
   out (`wait: false`) for the voiceover case.
2. **`type` duration mechanism** — _decided:_ per-call `{ duration }`, pinned. Omitted =
   default speed (see Timing model). No elastic auto-fit.
3. **Audio tail past video end** — _decided:_ require a trailing `wait` and **warn** if
   the last clip overruns the video (no silent freeze-pad — consistent with warn-don't-fix).
4. **Captions** — deferred. Same `Alignment` data drives a timed-text overlay later;
   leave the seam, don't build now.
5. **Timing: start-on-word, pinned/default, pauses-as-fenced-blocks, warn-don't-fix** —
   _decided._ See "Timing model (decided)" in §C.
6. **Caching: per-paragraph, mp3 default, audio+alignment entry, atomic/parallel** —
   _decided._ See "Caching (decided)" in §B.

## Build order

1. `audio()` primitive + recorder timeline tracking + mux (testable with a local mp3,
   no TTS).
2. Deterministic `type({ duration })` + `actionDelay: 0` compile mode.
3. `src/tts/` adapter + ElevenLabs + cache (unit-testable; one live key check).
4. Compiler: offset → word → wait math; emit chain; `gap < 0` warning.
5. `demos/08-voiceover/` end-to-end.

## Notes

- TTS is a network call with a secret → like browser launch, runs in the user's
  terminal, not the Bash sandbox.
- Nothing here touches the existing fluent API surface except the two additive
  methods (`audio`, `type` option). The JSON manifest gains `audio` + the `type`
  duration param, which propagates to schema + markers for free.
