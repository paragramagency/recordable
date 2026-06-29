# recordable

[![npm version](https://img.shields.io/npm/v/recordable.svg)](https://www.npmjs.com/package/recordable)

Programmatic, repeatable browser screen recording. Describe a session as a fluent
chain of actions — `visit`, `click`, `type`, `zoom`, `scroll` — and `recordable`
drives a real [Puppeteer](https://pptr.dev/) browser and captures a clean MP4,
complete with an animated cursor, smooth zooming/scrolling, and human-like typing.

Because the recording is _code_, it's deterministic and re-runnable: regenerate the
exact same capture whenever the UI changes — for product demos, onboarding clips,
documentation GIFs, release notes, or visual regression footage.

```ts
import { Recordable } from "recordable";

await new Recordable({ typingSpeed: 120 })
  .pause() // skip the initial page load
  .visit("https://example.com")
  .resume()
  .zoom(1.5, { origin: "#newsletter" })
  .type("#email", "hello@example.com")
  .click("text:Sign up")
  .scroll("bottom")
  .resetZoom()
  .wait(1500)
  .run(); // finalises automatically — bookends are optional
```

Recording is **on by default** and finalises when `.run()` ends. Use `pause()` /
`resume()` to carve out anything you don't want on camera; every captured segment
is stitched into one seamless MP4. Need explicit bookends or several output files?
`start()` / `end()` / `split()` move the file boundaries (see
[Multiple output files](#multiple-output-files-start--end--split)).

## Features

- **Fluent, queued API** — chain actions; nothing runs until `.run()`.
- **Deterministic & repeatable** — the recording is code, so it reproduces exactly.
- **Animated cursor overlay** with realistic movement and click feedback.
- **Smooth zoom & scroll** that animate origin and scale together.
- **Human-like typing** with jitter and natural pauses.
- **Element targeting** by full CSS selector or visible text — `:text(…)`
  composes with CSS, e.g. `button:text(Save)`.
- **Off-camera segments** — `pause()`/`resume()` skip setup, navigations, or whole
  screens; segments are auto-stitched into one seamless video.
- **New-tab recording** — `click(target, { followNewTab: true })` follows a link
  that opens in a new tab and keeps recording there, stitched into the same MP4.
- **Manual steps / logins** — `resumeOnPlay()` waits for an in-page ▶ Play button
  (see below), so you can sign in by hand before recording.
- **Auto-scroll** to bring elements into view before interacting.
- **Declarative scripts (JSON _or_ Markdown) + CLI** — author a recording as data,
  not code, and run it with `npx recordable demo.json` / `demo.md`, no install or
  TypeScript required. JSON ships a published schema for editor autocomplete;
  Markdown adds prose narration for voiceover.

## Install

```sh
npm install recordable
```

Frames are captured via the Chrome DevTools Protocol and encoded with **FFmpeg** —
there's no external screen-recorder dependency. The ffmpeg binary ships via
[`ffmpeg-static`](https://www.npmjs.com/package/ffmpeg-static),
so there's nothing else to install (a system `ffmpeg` on your `PATH` is used as a
fallback).

## Declarative scripts (JSON)

You don't have to write TypeScript. A recording can be a plain **JSON** file — an
array of `{ action, ... }` actions that map 1:1 onto the chainable API, optionally
wrapped with a `config`:

```json
{
  "$schema": "https://raw.githubusercontent.com/paragramagency/recordable/main/recordable.schema.json",
  "config": { "typingSpeed": 14 },
  "actions": [
    { "action": "pause" },
    { "action": "visit", "url": "https://example.com" },
    { "action": "resume" },
    { "action": "zoom", "level": 1.5, "origin": "#newsletter" },
    { "action": "type", "target": "#email", "text": "hello@example.com" },
    { "action": "click", "target": "text:Sign up" },
    { "action": "waitFor", "target": "text:Thanks", "state": "visible" },
    { "action": "resetZoom" }
  ]
}
```

Each step's keys are the named arguments of the matching method — `type(target, text)`
→ `{ "action": "type", "target": …, "text": … }`; `waitFor`'s `state`/`timeout` are
top-level keys. A `variables` sibling of `config` / `actions` defines reusable
[`{{name}}`](#variables) values: `{ "config": {…}, "variables": {…}, "actions": […] }`.

**Editor support.** Add the `"$schema"` line above (a URL, or a relative path to a
local copy) and your editor gives you autocomplete, required-key checking, and
typo catching for every action — no TypeScript needed. The schema is published as
`recordable.schema.json`.

Run a JSON script from code by handing it to a `Recordable` — a parsed object or
the raw file string both work:

```ts
import { readFileSync } from "node:fs";
import { Recordable } from "recordable";

const script = readFileSync("./demo.json", "utf8");
await new Recordable({ baseDir: "." }).fromJSON(script).run();
```

`baseDir` is the script's folder — `recordable` resolves relative `visit` URLs
and a relative `outputDir` against it. (Standalone `runScript` / `fromJSON`
helpers are also exported if you prefer a single call.)

## Declarative scripts (Markdown)

Markdown is the richest authoring surface — the **same actions as JSON**, written
as backtick method-call spans, with optional narration prose woven around them for
voiceover. YAML frontmatter carries the [config](#configuration); an optional
`voiceover` block opts into narration audio (`voiceover: true` reads provider /
voice from [`recordable.config.json`](#configuration-files), or pass an object to
set them inline), and an optional `variables` block defines reusable
[`{{name}}`](#variables) values for the document.

Two flavours, mixable in one document:

**1. A fenced action list** — one call per line, no prose. The closest Markdown
gets to JSON; compiles to the exact same actions:

````md
---
viewport: { width: 1280, height: 800 }
---

```
pause()
visit("./index.html")
resume()
zoom(1.4, { origin: "#email" })
type("#email", "hello@example.com")
click("text:Sign up", { waitForNav: true })
waitFor("text:Thanks", { state: "visible" })
resetZoom()
```
````

**2. Inline markers in prose** — drop call spans into narration; each fires at its
position in the spoken line. With `voiceover` on, the prose is read aloud and waits
are timed to the narration:

```md
---
typingSpeed: 16
voiceover: true
---

`visit("./signin.html")` Welcome — first we sign in with our work account
`type("#email", "maya@example.com")` then our password
`type("#password", "•••••")` `click("#signInBtn", { waitForNav: true })` — and
we're straight into the dashboard.
```

Each backtick span holds exactly one call; its arguments are the method's
arguments, identical to the chainable API and the JSON `action` keys. Whole-line
`//` comments are stripped before parsing, so toggle-comment in your editor is
safe.

**Reuse with `include`** — pull another Markdown script in where you call it, so a
common flow (sign-in, setup) lives in one file:

````md
```
include("./login.md")
visit("/dashboard")
```
````

The included file's steps and narration are spliced in at that point; its paths
resolve against its own folder, and its frontmatter is ignored (the top-level
document's config wins). An `include(...)` must stand alone — its own fenced line or
its own paragraph.

Run a Markdown file through the [CLI](#cli) (`npx recordable demo.md`) or from code:

```ts
import { readFileSync } from "node:fs";
import { Recordable } from "recordable";

const md = readFileSync("./demo.md", "utf8");
await new Recordable({ baseDir: "." }).fromMarkdown(md).run();
```

## Voiceover

A Markdown script can narrate itself. The prose around your inline markers becomes
spoken audio (text-to-speech), and the markers are **timed to the narration** — each
action fires at its position in the spoken line, so the demo and the voice stay in
sync without hand-tuned `wait`s.

Opt in from frontmatter. With a key in `.env` and provider/voice defaults in
[`recordable.config.json`](#configuration-files), `voiceover: true` is all a document
needs; spell out a `voiceover` object to set provider / voice / model inline (it
overrides the config file):

```yaml
voiceover: true
```

```yaml
voiceover:
  provider: elevenlabs # or `mock` for silent, offline audio
  voiceId: EXAVITQu4vr4xnSDxMaL
  modelId: eleven_multilingual_v2
```

**Credentials** are a secret, kept in a `.env` loaded automatically from **beside the
document** (copy [`.env.example`](.env.example)):

```sh
ELEVENLABS_API_KEY=...   # required for real synthesis (`mock` needs no key)
```

**Provider / voice / model defaults** are non-secret, so they live in a committed
[`recordable.config.json`](#configuration-files) under a `voiceover` block — set them
once and every document opts in with just `voiceover: true`:

```jsonc
{
  "voiceover": {
    "provider": "elevenlabs",
    "voiceId": "...",
    "modelId": "eleven_multilingual_v2",
  },
}
```

Frontmatter / explicit config still overrides the file. See
[Configuration files](#configuration-files) for the full `.env` vs. `recordable.config.json`
split and precedence.

Generated audio is written to the `assetsDir` (default `assets/`, beside the output)
and cached, so re-running an unchanged script doesn't re-synthesize. Validate a
voiceover script without hitting the TTS API — or a browser — with `recordable
demo.md --check`. For a music bed or a hand-recorded narration file, drop it straight
onto the timeline with `audio(path, opts?)` (see the [API](#recording)).

## CLI

Run a JSON **or** Markdown file directly — **no install required** via `npx`:

```sh
npx recordable demo.json
npx recordable demo.md
```

```
recordable <script.json | script.md> [options]

  --check          Validate the script and exit (no browser, no audio, no recording)
  --headless       Run without a visible browser window
  --silent         Suppress recorder console output
  --out-dir <dir>  Output directory (overrides the script's config)
  --name <name>    Output filename (without extension)
  --no-timestamp   Don't prepend an ISO timestamp to the filename
  --var name=value Set a variable (repeatable; highest precedence)
  --config <path>  Use this recordable.config.json (overrides auto-discovery)
  --env-file <path> Use this .env (overrides auto-discovery)
  --base-dir <path> Directory the config/.env walk starts from (default: script's folder)
  -h, --help       Show this help
```

Relative `visit` URLs (e.g. `"./index.html"`) and a relative `outputDir` resolve
against the script file, so a script, its mockups, and its output stay together
regardless of where you run it from. `--out-dir` overrides the output location
(taken relative to the current directory). `--check` validates a script in CI or
while authoring without launching a browser.

## Off-camera work & seamless segments

`pause()` stops the camera but the chain keeps running, so anything up to the
next `resume()` happens off-camera — page loads, data setup, even navigating to a
different screen. Each recorded stretch is a segment, and they're concatenated
(losslessly, by stream-copy where possible) into a single MP4 on `.run()`:

```ts
await new Recordable()
  .visit("/dashboard")
  .click("text:Reports") // recorded
  .pause()
  .visit("/admin") // off-camera: jump to another screen, reset state…
  .click("text:Seed demo data")
  .resume()
  .click("text:Run report") // recorded again — stitched seamlessly to the above
  .run();
```

## Recording behind a login (manual steps)

Run **headful** (`headless: false`) so the Chrome window is interactive. Keep the
camera off while you sign in by hand, then `resumeOnPlay()` waits for you to
click an **in-page ▶ Play button** (or press Enter) before recording resumes:

```ts
await new Recordable({ headless: false })
  .pause() // camera off — the login isn't recorded
  .visit("https://app.example.com/login")
  .resumeOnPlay("Log in, then click ▶ Play to start recording")
  .visit("https://app.example.com/dashboard")
  .click("text:New project")
  .run();
```

- **`resumeOnPlay(message?)`** waits for ▶ Play, then resumes recording. It's a thin
  wrapper for **`waitForPlay().resume()`** — the ▶ Play button is injected into the
  page itself and blocks until you click it (Enter in the terminal also works), and
  it's re-injected across navigations so it survives login redirects.
- **`waitForPlay(message?)`** is the gate on its own — it blocks on ▶ Play but leaves
  the camera untouched. Use it when you want to hold the script for a manual step
  that should stay off-camera, or pair it with `resume()` yourself.
- Prefer an automatic trigger? Use **`waitFor("#dashboard")`** after `resume()` to
  carry on once a post-login element appears — no clicking required.

Because the manual step sits inside a `pause()`, the sign-in never appears in the
video.

## Intros, outros & mid-rolls

`insert(path)` splices an external video clip into the timeline at that point —
its position decides the role: first call is an intro, last is an outro, anything
in between is a mid-roll. The clip is normalized to the recording's resolution,
fps, and codec so the join is seamless.

```ts
new Recordable()
  .insert("intro.mp4", { fadeIn: 500, fadeOut: 600 }) // plays first
  .visit("https://example.com")
  .click("text:Get started")
  .insert("feature-promo.mp4", { fadeIn: 600, fadeOut: 600 }) // mid-roll
  .scroll("bottom")
  .insert("outro.mp4", { fadeOut: 500 }) // plays last
  .run();
```

No `pause()`/`resume()` needed — `insert` seals the current segment and recording
resumes into a fresh one on the next action automatically. (Audio on the inserted
clip itself is currently dropped — narration voiceover is a separate, supported
feature, authored in [Markdown](#declarative-scripts-markdown).)

**Cross-fades.** Pass `fadeIn` / `fadeOut` (ms) to dissolve rather than hard-cut.
A fade blends the clip with the **neighbouring recorded footage** (a true
cross-dissolve), or fades from/to **black** at the timeline ends where there's no
neighbour — so an intro's `fadeIn` fades up from black and dissolves into the page
on `fadeOut`, while an outro's `fadeOut` dissolves down to black. Omit them for a
hard cut. A cross-fade of _d_ ms overlaps the two pieces by _d_, shortening the
timeline by that much at each faded boundary.

## Multiple output files (`start` / `end` / `split`)

`pause()`/`resume()` carve off-camera gaps **within one file**. To produce
**separate files**, move the file boundaries with `start()` / `end()` / `split()`:

```ts
await new Recordable({ outputName: "demo" })
  .start("intro") // open the first file (content before it is off-camera)
  .visit("https://example.com")
  .click("text:Get started")
  .split("checkout") // close "intro", open the next — camera keeps rolling
  .click("text:Buy")
  .end() // close "checkout"; the teardown below runs off-camera
  .click("text:Sign out")
  .run(); // → demo-intro.mp4, demo-checkout.mp4
```

- **Boundaries default to the script edges.** With no `start()`, recording opens
  at the top; with no `end()`, it closes at the bottom — so a plain script is one
  file, exactly as before. Add only the bookend you need.
- **`pause`/`resume` ≠ `start`/`end`.** `resume()` continues the _same_ file (the
  gap is stitched out); `start()`/`split()` open a _new_ file. `split() ≡ end() +
start()` fused with no gap; for two files _with_ an off-camera gap between them,
  use `end()` … `start()`.
- **Naming.** Each file is `${outputName}-${label ?? index}.mp4`; a label always
  wins. A single unlabelled file stays `${outputName}.mp4`.
- **Audio is per-file** — each output is standalone with its own zero-based
  timeline; a clip is assigned to the file containing its start.

`run()` resolves to a `RecordableResult` — `{ status, files: [{ path, label,
index, durationMs, bytes }], outputDir, durationMs, elapsedMs, warnings }` — so
you can find every file that was written. Hard failures throw instead.

## API

Create an instance with optional [config](#configuration), chain actions, then
`await .run()`.

### Recording

Recording is on by default and finalises automatically on `.run()`, which resolves
to a [`RecordableResult`](#multiple-output-files-start--end--split). `pause`/`resume`
control what lands on camera _within_ a file; `start`/`end`/`split` move the file
boundaries to produce [separate files](#multiple-output-files-start--end--split):

| Method                   | Description                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pause()`                | Stop capturing; the chain keeps running off-camera.                                                                                                                                                          |
| `resume()`               | Resume capturing in a fresh segment, immediately.                                                                                                                                                            |
| `start(name?)`           | Open an output file (opening boundary); content before the first `start()` is off-camera. `name` labels the file.                                                                                            |
| `end()`                  | Close the current output file (closing boundary); content after it runs off-camera.                                                                                                                          |
| `split(name?)`           | Close the current file and open the next in one move, camera still rolling — `end()` + `start()` with no gap.                                                                                                |
| `waitForPlay(message?)`  | Block until the user clicks the in-page ▶ Play button (or presses Enter); leaves recording state untouched.                                                                                                  |
| `resumeOnPlay(message?)` | Wait for ▶ Play, then resume capturing — `waitForPlay().resume()`.                                                                                                                                           |
| `insert(path, opts?)`    | Splice an external clip (intro / outro / mid-roll) into the timeline; `opts.fadeIn`/`fadeOut` (ms) cross-fade it.                                                                                            |
| `audio(path, opts?)`     | Lay an existing audio file (mp3/wav) onto the timeline here — narration, music bed, SFX. Blocks until the clip ends by default (`opts.wait: false` plays it over following actions); `opts.volume` gains it. |

### Navigation & waiting

| Method                   | Description                                                     |
| ------------------------ | --------------------------------------------------------------- |
| `visit(url, options?)`   | Navigate and wait for the page to settle.                       |
| `waitFor(target, opts?)` | Wait for an element to become `visible` / `hidden` / `present`. |
| `wait(ms)`               | Pause the sequence for `ms` milliseconds.                       |

### Interactions

| Method                                                           | Description                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `click(target, { waitForNav?, trimNavigation?, followNewTab? })` | Click an element. Returns immediately by default; pass `{ waitForNav: true }` when the click triggers a full-page navigation, or `{ followNewTab: true }` to keep recording in a tab the click opens (see notes below). `{ trimNavigation: false }` keeps that load on-camera. |
| `hover(target)`                                                  | Move onto an element to reveal `:hover` state (no click).                                                                                                                                                                                                                      |
| `type(target, text, { duration? })`                              | Type into a field with human-like timing; `duration` (ms) spreads keystrokes evenly with no jitter.                                                                                                                                                                            |
| `clear(target)`                                                  | Select-all + delete the contents of a field.                                                                                                                                                                                                                                   |
| `select(target, value)`                                          | Choose an option in a native `<select>` by `value`, or by `:option-index(N)` / `:option-label(Text)` (see note below; OS-drawn list isn't captured).                                                                                                                           |
| `key(key)`                                                       | Press a key, e.g. `"Escape"`, `"Enter"`, `"Tab"`.                                                                                                                                                                                                                              |
| `mouse(target \| {x, y})`                                        | Move the cursor to an element or coordinates.                                                                                                                                                                                                                                  |

> The browser draws an open `<select>`'s option list with the OS, outside the page,
> so the screencast can't capture it — `select()` shows the cursor and the value
> changing, but not the dropdown. For an on-camera dropdown, build a custom one from
> `click()`s.
>
> `value` matches the `<option>`'s `value` attribute by default. To pick without
> knowing it, use `":option-index(1)"` (1-based, like `:nth-child`) or
> `":option-label(Pro tier)"` to match the option's visible text.

> A plain `click()` does not wait for navigation. If the click loads a new page
> (a link, a form submit), add `{ waitForNav: true }` so the next action lands on
> the loaded page instead of racing it — the wait is armed before the click and
> the navigation must land, like `visit()`. For SPA route changes or async content
> (no full-page load) there's nothing to wait on — follow the click with
> `waitFor("<selector>")` for an element on the new view instead.

> When a click opens a link in a **new tab**, pass `{ followNewTab: true }`:
> `recordable` switches capture to the new tab and stitches it into the same
> recording (the new tab's load happens off-camera, the old tab stays open).
> Without it, recording stays on the original tab.

> **Navigation is trimmed by default.** With `trimNavigation` on (the default),
> a same-tab navigation — `visit(url)` or a `waitForNav` click — seals the clip
> at the action and runs the page load off-camera, so the video cuts straight
> from action to result with no dead loading time. Because the load captures no
> frames, its duration never advances the recorded timeline, which keeps
> voiceover/narration timing deterministic (page-load time stops being a variable
> the alignment has to absorb). Set `trimNavigation: false` globally to keep loads
> on-camera, or per click with `click(target, { waitForNav: true, trimNavigation: false })`.

### Camera

| Method                                             | Description                                                                                                                                                                                                                                                       |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scroll(target, { container?, duration?, axis? })` | Smooth-scroll to `"top"`/`"bottom"` (or `"left"`/`"right"`), a selector, or an offset. `axis: "x"` scrolls horizontally for a number/selector target (keywords infer it). `container` scrolls a named overflow pane (modal, sidebar, list) instead of the window. |
| `zoom(level, { origin?, duration? })`              | Smoothly scale from an origin (keyword, `%`, or selector).                                                                                                                                                                                                        |
| `resetZoom({ duration? })`                         | Smoothly return to 1×.                                                                                                                                                                                                                                            |
| `setConfig(config)`                                | Merge config mid-sequence (takes effect at that point).                                                                                                                                                                                                           |

### Targeting

Anywhere a `target` is accepted you can pass:

- a **full CSS selector** — IDs, classes, attributes, combinators, and
  positional pseudo-classes all work: `"#id"`, `".card"`, `'[name="email"]'`,
  `"nav > ul li[data-active]"`, `"table tr:nth-child(3) td:first-child"`,
  `"section:has(> h2)"`.
- **visible text** with the `:text(…)` pseudo — `":text(Sign up)"` matches the
  smallest element containing that text, and it **composes with CSS** so you can
  scope it: `"button:text(Save)"`, `"nav a:text(Pricing)"`,
  `"table tr:nth-child(3) td:text(Done)"`. The text is bare (unquoted); it can
  hold spaces and commas but not a literal `)`.
- **Puppeteer selectors** also pass through untouched — `::-p-aria(Submit)` for
  accessible name, `>>>` to pierce shadow DOM.
- the **`:nth(N)`** pseudo picks the **Nth match** (1-based, document order) of
  everything the selector matches — unlike CSS `:nth-child`/`:nth-of-type`, which
  only count among siblings. It composes with `:text()`:
  `"a:text(Business Loans):nth(2)"` is the second link whose text contains
  "Business Loans"; `"button[type=submit]:nth(2)"` the second submit button.
  Indexing is over _visible_ matches (hidden duplicates are skipped). It must be
  the single, trailing marker on the target.

> The legacy whole-string `text:` prefix (`"text:Sign up"`) still works as an
> alias for `:text(…)`.

If a target matches more than one element, `recordable` logs a warning and acts
on the first — tighten the selector, or use `:nth(N)` to pick one, to silence it.

## Configuration

All options are optional; defaults shown.

```ts
new Recordable({
  viewport: { width: 1920, height: 1080 },
  pageZoom: 1, // browser page zoom (Ctrl +/−); <1 reflows to fit more on screen
  fps: 30,
  outputDir: "output", // relative paths resolve against baseDir
  outputName: "recordable",
  outputTimestamp: true, // prepend an ISO timestamp to the filename
  assetsDir: "assets", // where generated voiceover audio is written (relative to baseDir)
  headless: false,
  launchArgs: [], // extra Chromium flags, e.g. ["--no-sandbox"] for CI/containers
  language: "", // BCP-47 locale, e.g. "fr-FR" (--lang + --accept-lang + Accept-Language); "" = system
  typingSpeed: 7, // characters per second
  videoCrf: 18, // lower = better quality, larger file
  videoCodec: "libx264",
  videoPreset: "ultrafast",
  zoomDuration: 600, // ms
  actionDelay: 300, // ms inserted between every action
  silent: false,
  autoScroll: true, // scroll elements into view before interacting
  scrollMargin: 120, // px kept around an element when auto-scrolling
  scrollSpeed: 1500, // px/s
  scrollDuration: 1200, // ms for the scroll action's transition
  cursor: true, // show the animated cursor overlay
  visitTimeout: 30_000, // ms for navigation / waitFor
  trimNavigation: true, // run a same-tab nav's page load off-camera (see notes under Interactions)
  baseDir: "", // dir that relative visit URLs, outputDir & assetsDir resolve against; "" = cwd
});
```

Any option can also be defaulted from a committed
[`recordable.config.json`](#configuration-files) beside the document (e.g.
`{ "fps": 60, "viewport": { "width": 1920, "height": 1080 } }`). Precedence, low →
high: built-in defaults → `recordable.config.json` → frontmatter / JSON `config` →
explicit `new Recordable({...})` / CLI flags.

Read the fully-resolved result back with `getConfig()` — a snapshot, after all
layering and path resolution:

```ts
const rec = new Recordable({ baseDir: "." }).fromMarkdown(md);
rec.getConfig().fps; // → the resolved fps
rec.getConfig().outputDir; // → absolute, resolved against baseDir
```

## Configuration files

Two files sit beside your scripts, with one rule between them: **`.env` is secrets
only; `recordable.config.json` is everything committable.**

| File                     | Committed? | Holds                                                                                                                 |
| ------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| `.env`                   | gitignored | Secrets only — `ELEVENLABS_API_KEY` and secret variables under a `VAR_` prefix (e.g. `VAR_ADMIN_PASSWORD`).           |
| `recordable.config.json` | committed  | Non-secret default [config](#configuration) (flat, natively typed), plus reserved `variables` and `voiceover` blocks. |

`recordable.config.json` is **flat** — config keys at the top level, with `variables`
and `voiceover` as reserved siblings (the same shape as Markdown frontmatter and the
constructor argument). Validate it in your editor with a `$schema` pointer; copy
[`recordable.config.example.json`](recordable.config.example.json) to start:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/paragramagency/recordable/main/recordable.config.schema.json",
  "fps": 30,
  "viewport": { "width": 1920, "height": 1080 },
  "variables": { "siteUrl": "https://app.example.com", "userName": "Ada" },
  "voiceover": {
    "provider": "elevenlabs",
    "voiceId": "...",
    "modelId": "eleven_multilingual_v2",
  },
}
```

```sh
# .env — secrets only
ELEVENLABS_API_KEY=...
VAR_ADMIN_PASSWORD=...
```

Both files are **auto-discovered** by walking up from the script's folder
(`baseDir`) to the current directory, and depth-merged — a deeper file overrides a
shallower one per key — so a folder of demos shares one setup while a subfolder
tweaks it. Override discovery on the CLI with `--config <path>`, `--env-file <path>`,
or `--base-dir <path>` (the directory the walk starts from).

> **This retires the old `DEFAULT_<UPPER_SNAKE>` env vars.** `DEFAULT_FPS`,
> `DEFAULT_VIEWPORT`, `DEFAULT_TTS_PROVIDER`/`DEFAULT_VOICE_ID`/`DEFAULT_MODEL_ID`,
> etc. are gone — put non-secret config in `recordable.config.json` (voiceover
> defaults in its `voiceover` block) and keep only secrets in `.env`.

## Variables

Define a value once and reference it with `{{ name }}` anywhere a script takes a
**string** — selectors, `visit` URLs, typed text, file paths, and Markdown narration
prose. Names are **case- and separator-insensitive**, so `VAR_EMAIL_ADDRESS`,
`emailAddress`, and `{{email_address}}` are one variable.

```ts
click("{{submit_btn}}");
type("{{email_input}}", "{{email_address}}");
visit("{{siteUrl}}/dashboard");
```

```md
Welcome to {{productName}} — let's sign in.
```

**Sources**, lowest → highest precedence:

1. `.env` `VAR_*` (and `process.env` `VAR_*`, which beats a committed `.env`)
2. `recordable.config.json` `variables` (depth-merged across the folder walk)
3. frontmatter / JSON `variables`
4. **programmatic** — constructor `variables`, `.variables(map)`, `.variable(name, value)`, and CLI `--var name=value`

Resolution is **type-major**: every variables source beats every env (`VAR_*`)
source. Provide variables programmatically three interchangeable ways — they all feed
the top-priority programmatic layer, applied in chain order (a mid-chain `.variable()`
affects only later actions):

```ts
new Recordable({ viewport, variables: { siteUrl: "https://app.example.com" } })
  .variables({ userName: "Ada" })
  .variable("plan", "pro")
  .fromMarkdown("./demo.md")
  .run();
```

- `{{ some code }}` that isn't a valid name is **left literal**, so technical
  narration won't trip the system.
- `\{{name}}` escapes a literal that would otherwise resolve.
- A **missing** variable is a hard error, thrown at enqueue time, naming the variable
  and the sources searched.

## Development

```sh
npm install
npm run build         # type-check + emit dist/ with .d.ts
npm run gen:schema    # regenerate both JSON schemas (script + config) from src
npm test              # unit + ffmpeg I/O tests
npm run test:e2e      # opt-in end-to-end pipeline run (launches a browser)
npx tsx my-script.ts  # run a recording script directly
node dist/cli.js demo.json   # run a JSON script through the CLI locally
node dist/cli.js demo.md      # run a Markdown script through the CLI locally
```

The JSON action set and its schema are both generated from one manifest in
`src/actions.ts`; run `npm run gen:schema` after changing it. It writes two committed
schemas — `recordable.schema.json` (script files) and `recordable.config.schema.json`
(for `recordable.config.json`).

## License

MIT © Cam Parry
