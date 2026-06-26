# recordable

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
  .run(); // finalises automatically — no start()/stop()
```

Recording is **on by default** and finalises when `.run()` ends — there's no
`start()`/`stop()`. Use `pause()` / `resume()` to carve out anything you don't
want on camera; every captured segment is stitched into one seamless MP4.

## Features

- **Fluent, queued API** — chain actions; nothing runs until `.run()`.
- **Deterministic & repeatable** — the recording is code, so it reproduces exactly.
- **Animated cursor overlay** with realistic movement and click feedback.
- **Smooth zoom & scroll** that animate origin and scale together.
- **Human-like typing** with jitter and natural pauses.
- **Element targeting** by CSS selector or visible text (`text:` prefix).
- **Off-camera segments** — `pause()`/`resume()` skip setup, navigations, or whole
  screens; segments are auto-stitched into one seamless video.
- **Manual steps / logins** — `resumeOnInput()` waits for an in-page ▶ Play button
  (see below), so you can sign in by hand before recording.
- **Auto-scroll** to bring elements into view before interacting.
- **Declarative JSON scripts + CLI** — author a recording as JSON (with a published
  schema for editor autocomplete) and run it with `npx recordable demo.json`, no
  install or TypeScript required.

## Install

```sh
npm install recordable
```

Frames are captured via the Chrome DevTools Protocol and encoded with **FFmpeg** —
there's no external screen-recorder dependency. The ffmpeg binary ships via
[`@ffmpeg-installer/ffmpeg`](https://www.npmjs.com/package/@ffmpeg-installer/ffmpeg),
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
top-level keys.

**Editor support.** Add the `"$schema"` line above (a URL, or a relative path to a
local copy) and your editor gives you autocomplete, required-key checking, and
typo catching for every action — no TypeScript needed. The schema is published as
`recordable.schema.json`.

Run a script from code with `runScript` (or `fromJSON` to build without running):

```ts
import { runScript } from "recordable";
import demo from "./demo.json" with { type: "json" };

await runScript(demo);
```

### CLI

Or run a JSON file directly — **no install required** via `npx`:

```sh
npx recordable demo.json
```

```
recordable <script.json> [options]

  --check          Validate the script and exit (no browser, no recording)
  --headless       Run without a visible browser window
  --silent         Suppress recorder console output
  --out-dir <dir>  Output directory (overrides the script's config)
  --name <name>    Output filename (without extension)
  --no-timestamp   Don't prepend an ISO timestamp to the filename
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
camera off while you sign in by hand, then `resumeOnInput()` waits for you to
click an **in-page ▶ Play button** (or press Enter) before recording resumes:

```ts
await new Recordable({ headless: false })
  .pause() // camera off — the login isn't recorded
  .visit("https://app.example.com/login")
  .resumeOnInput("Log in, then click ▶ Play to start recording")
  .visit("https://app.example.com/dashboard")
  .click("text:New project")
  .run();
```

- **`resumeOnInput(message?)`** injects a ▶ Play button into the page itself and
  blocks until you click it (Enter in the terminal also works). The button is
  re-injected across navigations, so it survives login redirects.
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
resumes into a fresh one on the next action automatically. (Audio on the clip is
currently dropped; voiceover support is on the roadmap.)

**Cross-fades.** Pass `fadeIn` / `fadeOut` (ms) to dissolve rather than hard-cut.
A fade blends the clip with the **neighbouring recorded footage** (a true
cross-dissolve), or fades from/to **black** at the timeline ends where there's no
neighbour — so an intro's `fadeIn` fades up from black and dissolves into the page
on `fadeOut`, while an outro's `fadeOut` dissolves down to black. Omit them for a
hard cut. A cross-fade of _d_ ms overlaps the two pieces by _d_, shortening the
timeline by that much at each faded boundary.

## API

Create an instance with optional [config](#configuration), chain actions, then
`await .run()`.

### Recording

Recording is on by default and finalises automatically on `.run()`. These control
what lands on camera:

| Method                    | Description                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pause()`                 | Stop capturing; the chain keeps running off-camera.                                                               |
| `resume()`                | Resume capturing in a fresh segment, immediately.                                                                 |
| `resumeOnInput(message?)` | Resume only after the user clicks the in-page ▶ Play button (or presses Enter).                                   |
| `insert(path, opts?)`     | Splice an external clip (intro / outro / mid-roll) into the timeline; `opts.fadeIn`/`fadeOut` (ms) cross-fade it. |

### Navigation & waiting

| Method                   | Description                                                     |
| ------------------------ | --------------------------------------------------------------- |
| `visit(url, options?)`   | Navigate and wait for the page to settle.                       |
| `waitFor(target, opts?)` | Wait for an element to become `visible` / `hidden` / `present`. |
| `wait(ms)`               | Pause the sequence for `ms` milliseconds.                       |

### Interactions

| Method                              | Description                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| `click(target)`                     | Click an element.                                                                                   |
| `hover(target)`                     | Move onto an element to reveal `:hover` state (no click).                                           |
| `type(target, text, { duration? })` | Type into a field with human-like timing; `duration` (ms) spreads keystrokes evenly with no jitter. |
| `clear(target)`                     | Select-all + delete the contents of a field.                                                        |
| `select(target, value)`             | Choose an option in a native `<select>` (the OS-drawn option list isn't captured — see note below). |
| `key(key)`                          | Press a key, e.g. `"Escape"`, `"Enter"`, `"Tab"`.                                                   |
| `mouse(target \| {x, y})`           | Move the cursor to an element or coordinates.                                                       |

> The browser draws an open `<select>`'s option list with the OS, outside the page,
> so the screencast can't capture it — `select()` shows the cursor and the value
> changing, but not the dropdown. For an on-camera dropdown, build a custom one from
> `click()`s.

### Camera

| Method                                | Description                                                       |
| ------------------------------------- | ----------------------------------------------------------------- |
| `scroll(target, { duration? })`       | Smooth-scroll to `"top"`/`"bottom"`, a selector, or a Y position. |
| `zoom(level, { origin?, duration? })` | Smoothly scale from an origin (keyword, `%`, or selector).        |
| `resetZoom({ duration? })`            | Smoothly return to 1×.                                            |
| `setConfig(config)`                   | Merge config mid-sequence (takes effect at that point).           |

### Targeting

Anywhere a `target` is accepted you can pass:

- a **CSS selector** — `"#id"`, `".card"`, `'[name="email"]'`
- a **`text:` prefix** — `"text:Sign up"` matches by visible text

## Configuration

All options are optional; defaults shown.

```ts
new Recordable({
  viewport: { width: 1920, height: 1080 },
  fps: 30,
  outputDir: "./output",
  outputName: "recordable",
  outputTimestamp: true, // prepend an ISO timestamp to the filename
  headless: false,
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
  cursor: true, // show the animated cursor overlay
  visitTimeout: 30_000, // ms for navigation / waitFor
});
```

## Development

```sh
npm install
npm run build         # type-check + emit dist/ with .d.ts
npm run gen:schema    # regenerate recordable.schema.json from the action manifest
npx tsx my-script.ts  # run a recording script directly
node dist/cli.js demo.json   # run a JSON script through the CLI locally
```

The JSON action set and its schema are both generated from one manifest in
`src/actions.ts`; run `npm run gen:schema` after changing it.

## License

MIT © Cam Parry
