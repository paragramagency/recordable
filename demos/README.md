# Demos & manual-test fixtures

Self-contained demos that double as manual test cases. Each folder has a static
HTML mockup (no network) and a `demo.ts` (or `demo.json`) script that drives it.
Each demo writes its MP4 into its **own** `output/` subfolder
(e.g. `demos/01-simple/output/demo-01-simple.mp4`).

Run from the repo root, in your own terminal (browser launch needs a real
session — not the sandbox):

```sh
npx tsx demos/01-simple/demo.ts
npx tsx demos/02-complex/demo.ts
npx tsx demos/03-wait-for-user/demo.ts   # headful — requires manual sign-in
npx tsx demos/04-insert/demo.ts
npx tsx demos/05-json/demo.ts             # declarative JSON script, not TypeScript
npm run build && node dist/cli.js demos/06-cli/demo.json   # same, via the CLI binary
```

| # | Folder              | Mockup                          | Exercises |
|---|---------------------|---------------------------------|-----------|
| 0 | `00-kitchen-sink`   | — (reference only, not run)     | every method + every option + every config field, in one annotated chain |
| 1 | `01-simple`         | newsletter signup (1 page)      | visit · zoom · type · click · waitFor |
| 2 | `02-complex`        | SaaS app (3 linked pages + CSS) | search · hover menu · key(Escape) · cross-page nav · modal · select · pause/resume off-camera · scroll · zoom |
| 3 | `03-wait-for-user`  | login → home (2 pages)          | `resumeOnInput()` manual login behind a `pause()` |
| 4 | `04-insert`         | product landing page (1 page)   | `insert()` intro / mid-roll / outro — splices the bundled `*.mp4` clips in with `fadeIn`/`fadeOut` cross-fades |
| 5 | `05-json`           | newsletter signup (1 page)      | the **JSON script format** (`demo.json`) run via `runScript` — same flow as #1, authored as data |
| 6 | `06-cli`            | feedback form (1 page)          | the **CLI** — `demo.json` (type · select · waitFor) run through the `recordable` binary, no TypeScript |

### Kitchen-sink reference (`00-kitchen-sink`)

`demo.ts` here is a **reference, not a walkthrough** — it drives no real page and
is not meant to run. It lays out every method, every options bag, and every config
field with its default, in one annotated chain. It's excluded from the build but
still typechecks against the live `src` types, so it can't silently drift from the
API.

### JSON demo (`05-json`)

`demo.json` is a declarative script — an array of flat `{ action, ... }` steps
under a top-level `config`. `demo.ts` runs it programmatically via `runScript`,
resolving the relative `visit` URL and `outputDir` against the script's folder.

### CLI demo (`06-cli`)

The same idea, run through the published CLI instead of a runner script — the
folder is *just* a mockup and a `demo.json`, no `.ts` at all:

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

The TypeScript demos resolve their mockups and output via
`new URL("./…", import.meta.url)`, so they too work from any working directory.
