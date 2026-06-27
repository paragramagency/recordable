# Demos & manual-test fixtures

Self-contained demos that double as manual test cases. They all drive **one
shared mockup** — the "Dispatch" shipping-tracker site in [`site/`](./site)
(no network) — each focusing on a different slice of it; the only per-demo file
is the `demo.ts` (or `demo.json`) script. Each demo writes its MP4 into its
**own** `output/` subfolder (e.g. `demos/01-simple/output/demo-01-simple.mp4`).

The shared site is a set of linked static pages — `signin`, `index` (shipments
dashboard), `new`, `label`, `track`, `reports`, `settings` — sharing `app.css`
and a `shell.js` that renders the common sidebar + topbar.

Run from the repo root, in your own terminal (browser launch needs a real
session — not the sandbox):

```sh
npx tsx demos/01-simple/demo.ts
npx tsx demos/02-complex/demo.ts
npx tsx demos/03-wait-for-user/demo.ts   # headful — requires manual sign-in
npx tsx demos/04-insert/demo.ts
npx tsx demos/05-json/demo.ts             # declarative JSON script, not TypeScript
npm run build && node dist/cli.js demos/06-cli/demo.json   # same, via the CLI binary
npm run build && node dist/cli.js demos/07-md-voiceover/demo.md   # markdown + voiceover (needs ELEVENLABS_API_KEY)
node dist/cli.js demos/07-md-voiceover/demo.md --check            # validate only — no audio, no browser
node dist/cli.js demos/08-showcase/demo.md       # narrated full walkthrough + branded intro/outro
npx tsx demos/08-showcase/demo.ts                # same, programmatically
node dist/cli.js demos/09-md-actions/demo.md       # markdown, no voiceover — a single fenced action list
```

All demos drive the shared `site/` mockup; the column notes which slice each uses.

| # | Folder              | Focus on the site               | Exercises |
|---|---------------------|---------------------------------|-----------|
| 0 | `00-kitchen-sink`   | — (reference only, not run)     | every method + every option + every config field, in one annotated chain |
| 1 | `01-simple`         | new-shipment form → label       | visit · zoom · type · click · waitFor |
| 2 | `02-complex`        | dashboard ↔ reports ↔ settings  | search · hover menu · key(Escape) · cross-page nav · modal · select · pause/resume off-camera · scroll · zoom |
| 3 | `03-wait-for-user`  | sign-in → dashboard             | `resumeOnPlay()` manual login behind a `pause()` |
| 4 | `04-insert`         | dashboard → new shipment → label | `insert()` intro / mid-roll / outro — splices the bundled `*.mp4` clips in with `fadeIn`/`fadeOut` cross-fades |
| 5 | `05-json`           | new-shipment form → label       | the **JSON script format** (`demo.json`) run via `Recordable.fromJSON` — same flow as #1, authored as data |
| 6 | `06-cli`            | new-shipment form → label       | the **CLI** — `demo.json` (type · select · waitFor) run through the `recordable` binary, no TypeScript |
| 7 | `07-md-voiceover`   | new-shipment form → label       | the **Markdown** surface — `demo.md`: prose + inline markers → voiceover audio + computed waits, run straight through the CLI |
| 8 | `08-showcase`       | full flow (sign in → track)     | the **finished-product** demo — a narrated `demo.md` walkthrough (sign in · new shipment · generate label · mark shipped · track) with branded `intro.mp4`/`outro.mp4` cards baked by `make-cards.mjs` and spliced in |
| 9 | `09-md-actions`       | new-shipment form → label       | **Markdown without voiceover** — a single fenced action list (one call per line), no prose. Compiles through the core parser to a plain chain (same IR as JSON), records offline with zero TTS |

### Kitchen-sink reference (`00-kitchen-sink`)

`demo.ts` here is a **reference, not a walkthrough** — it drives no real page and
is not meant to run. It lays out every method, every options bag, and every config
field with its default, in one annotated chain. It's excluded from the build but
still typechecks against the live `src` types, so it can't silently drift from the
API.

### JSON demo (`05-json`)

`demo.json` is a declarative script — an array of flat `{ action, ... }` actions
under a top-level `config`. `demo.ts` runs it programmatically in one chain —
`new Recordable({ baseDir }).fromJSON(script).run()` — with `baseDir` resolving
the relative `visit` URL and `outputDir` against the script's folder.

### CLI demo (`06-cli`)

The same idea, run through the published CLI instead of a runner script — the
folder is *just* a `demo.json` (it drives the shared `../site`), no `.ts` at all:

```sh
npm run build                          # once, to produce dist/cli.js
node dist/cli.js demos/06-cli/demo.json
# once published: npx recordable demos/06-cli/demo.json
node dist/cli.js demos/06-cli/demo.json --check   # validate without recording
```

The CLI resolves the relative `visit` URL **and** `outputDir` against the script
file, so it works from any directory — the MP4 lands in
`demos/06-cli/output/demo-06-cli.mp4`. Pass `--out-dir` to override (that path is
taken relative to the current directory).

The TypeScript demos resolve the shared `../site` mockup and their output via
`new URL("…", import.meta.url)`, so they too work from any working directory.

### Markdown + voiceover demo (`07-md-voiceover`)

`demo.md` authors the flow as narration prose with inline backtick markers.
Its `voiceover` frontmatter makes the synth generate audio and compute `wait`s so
each action starts on its narrated word. Run it via the CLI or the one-line `demo.ts`:

```sh
node dist/cli.js demos/07-md-voiceover/demo.md          # synthesize + record
node dist/cli.js demos/07-md-voiceover/demo.md --check  # validate only, offline
npx tsx demos/07-md-voiceover/demo.ts                   # same, programmatically
```

`demo.ts` is the programmatic reference: read the file, load a sibling `.env`
(`ELEVENLABS_API_KEY`), then configure, load, and run as one chain —

```ts
await new Recordable({ baseDir: dir }).fromMarkdown(md).run();
```

`fromMarkdown` is a synchronous, chainable builder step like `fromJSON` (voiceover
synthesis is deferred to `run()`), so it reads just like the basic demos. Config
goes in the constructor; the document's frontmatter layers *under* it (so what you
pass explicitly wins). `baseDir` is the document's folder: Recordable resolves the
doc's relative `visit` URL against it, **loads a sibling `.env`** (for
`ELEVENLABS_API_KEY`), and defaults `outputDir`/`assetsDir` to `<baseDir>/output`
and `<baseDir>/assets` (audio is gitignored; reruns reuse the cache).
Provider/voice/model default from `RECORDABLE_TTS_PROVIDER` / `RECORDABLE_VOICE_ID`
/ `RECORDABLE_MODEL_ID`, so with those set a document opts in with just
`voiceover: true` in its frontmatter (anything spelled out overrides them).
ElevenLabs with no key (config or env) throws; set `RECORDABLE_TTS_PROVIDER=mock`
for silent audio. The CLI does the same — just `recordable demo.md`.

### Showcase demo (`08-showcase`)

The most complete demo: a narrated `demo.md` that signs in, creates a shipment,
generates a label, marks it shipped, and tracks it — bookended by branded title
cards. The cards are *external* clips spliced in with `insert()`, baked once (not
re-rendered each run) by a small generator that uses the bundled ffmpeg:

```sh
node demos/08-showcase/make-cards.mjs        # writes intro.mp4 / outro.mp4
node dist/cli.js demos/08-showcase/demo.md   # synthesize narration + record
```

Like demo 7, the narration needs an `ELEVENLABS_API_KEY` (from a sibling `.env`);
set `RECORDABLE_TTS_PROVIDER=mock` for silent audio. Edit the card text/colours in
`make-cards.mjs` and re-run it to rebrand.
