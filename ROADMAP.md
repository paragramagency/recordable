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

### 2. Voiceover polish

- **Narration-text auto-detection** — infer voiceover from prose alone, dropping even the
  `voiceover: true` flag.
- **On-screen captions** rendered from the same narration + alignment.

### 3. AI authoring

Mostly "great docs + clean formats" (an AI emits the JSON/Markdown). Optional later:
**record-mode codegen** — watch a human click through once, emit the script — as a more
reliable alternative to LLM-from-scratch.

### 4. Demo-ready product

The showcase (`08-showcase`) covers the headline flow. Remaining is general polish: more
demos, tightening rough edges so the whole thing is presentable.

## Done

### Variables system + config-file split (merged, unreleased)

Split the three jobs `.env` was overloaded with: **secrets** (`ELEVENLABS_API_KEY`,
secret `VAR_*`) stay in a gitignored `.env`; **default config + voiceover defaults +
shared variables** move to a committed, natively-typed `recordable.config.json` (flat:
config keys at top level, plus reserved `variables` / `voiceover` siblings). This retires
the `DEFAULT_<UPPER_SNAKE>` env prefix and its string-coercion entirely. Variables are
referenced with `{{ name }}` in action string args (selectors, `visit` URLs, typed text,
paths) and Markdown narration; names are case- and separator-insensitive
(`VAR_EMAIL_ADDRESS` ≡ `emailAddress` ≡ `{{email_address}}`). Sources resolve lowest →
highest: `.env`/`process.env` `VAR_*` < `config.json` `variables` < frontmatter / JSON
`variables` < programmatic (constructor `variables` + `.variables()` / `.variable()` +
CLI `--var`), type-major (all variables beat all env). New CLI flags `--var`, `--config`,
`--env-file`, `--base-dir`; a second committed schema `recordable.config.schema.json`
(written alongside `recordable.schema.json` by `npm run gen:schema`). Spec in
`specs/variables.md`.

## Code quality

- **General code cleanup and reorganization** (ongoing).
- **Proper, thorough error handling** throughout — the obvious paths now surface errors
  (logging, play-button injection, step validation with `cause`); a deliberate sweep of
  the rest is still worth doing.

## Cleanup / tech debt

- **Demos are tracked** (in `demos/`); only the generated artifacts — the output MP4s and any
  audio — are gitignored (`demos/**/assets/`). Add better demos later. Flattened from the old
  `examples/` + `examples/demos/` split into a single numbered `demos/` folder
