# recordable

Programmatic, repeatable browser screen recording. Describe a session as a fluent
chain of actions — `visit`, `click`, `type`, `zoom`, `scroll` — and `recordable`
drives a real [Puppeteer](https://pptr.dev/) browser and captures a clean MP4,
complete with an animated cursor, smooth zooming/scrolling, and human-like typing.

Because the recording is *code*, it's deterministic and re-runnable: regenerate the
exact same capture whenever the UI changes — for product demos, onboarding clips,
documentation GIFs, release notes, or visual regression footage.

```ts
import { Recordable } from "recordable";

await new Recordable({ cursor: true, typingSpeed: 120 })
  .visit("https://example.com")
  .start()
  .zoom(1.5, "#hero")
  .type("#email", "hello@example.com")
  .click("text:Sign up")
  .scroll("bottom")
  .resetZoom()
  .wait(1500)
  .stop()
  .run();
```

## Features

- **Fluent, queued API** — chain actions; nothing runs until `.run()`.
- **Deterministic & repeatable** — the recording is code, so it reproduces exactly.
- **Animated cursor overlay** with realistic movement and click feedback.
- **Smooth zoom & scroll** that animate origin and scale together.
- **Human-like typing** with jitter and natural pauses.
- **Element targeting** by CSS selector or visible text (`text:` prefix).
- **Manual steps / logins** — pause for hands-on interaction, then record (see below).
- **Auto-scroll** to bring elements into view before interacting.

## Install

```sh
npm install recordable
```

Recording is done by [`puppeteer-screen-recorder`](https://www.npmjs.com/package/puppeteer-screen-recorder),
which shells out to **FFmpeg** — make sure `ffmpeg` is installed and on your `PATH`.

## Recording behind a login (manual steps)

The hard part of recording a real app is the bits you *can't* script — usually a
login. The trick: run **headful** (`headless: false`) so the Chrome window
Puppeteer opens is fully interactive. Open the login page, sign in by hand, then
start recording once you're through the gate. Two triggers:

```ts
await new Recordable({ headless: false, cursor: true })
  .visit("https://app.example.com/login")
  .pause("Log in, then press Enter to start recording…") // ① blocks on terminal Enter
  // .waitFor("#dashboard")                               // ② or auto-resume on a selector
  .start()                                                // recording begins AFTER the manual step
  .visit("https://app.example.com/dashboard")
  .click("text:New project")
  .stop()
  .run();
```

- **`pause(message?)`** blocks the chain until you press **Enter** in the
  terminal. Works for any login UI. No-op in headless mode.
- **`waitFor(selector)`** resumes automatically when an element appears — handy
  when you'd rather not touch the keyboard. Accepts `text:` targets too.

Put the manual step *before* `start()` and the sign-in never appears in the video.

## API

Create an instance with optional [config](#configuration), chain actions, then
`await .run()`.

### Recording
| Method | Description |
| --- | --- |
| `start()` | Begin recording. Place anywhere in the chain. |
| `stop()` | Stop recording and flush the MP4. |

### Navigation & waiting
| Method | Description |
| --- | --- |
| `visit(url, options?)` | Navigate and wait for the page to settle. |
| `pause(message?)` | Block until you press Enter in the terminal (manual step). |
| `waitFor(target, opts?)` | Wait for an element to become `visible` / `hidden` / `present`. |
| `wait(ms)` | Pause the sequence for `ms` milliseconds. |

### Interactions
| Method | Description |
| --- | --- |
| `click(target)` | Click an element. |
| `hover(target)` | Move onto an element to reveal `:hover` state (no click). |
| `type(target, text)` | Type into a field with human-like timing. |
| `clear(target)` | Select-all + delete the contents of a field. |
| `select(target, ...values)` | Choose options in a native `<select>`. |
| `key(key)` | Press a key, e.g. `"Escape"`, `"Enter"`, `"Tab"`. |
| `mouse(target \| {x, y})` | Move the cursor to an element or coordinates. |

### Camera
| Method | Description |
| --- | --- |
| `scroll(target, duration?)` | Smooth-scroll to `"top"`/`"bottom"`, a selector, or a Y position. |
| `zoom(level, origin?, duration?)` | Smoothly scale from an origin (keyword, `%`, or selector). |
| `resetZoom(duration?)` | Smoothly return to 1×. |
| `setConfig(config)` | Merge config mid-sequence (takes effect at that point). |

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
  outputTimestamp: true,   // prepend an ISO timestamp to the filename
  headless: false,
  typingSpeed: 7,          // characters per second
  videoCrf: 18,            // lower = better quality, larger file
  videoCodec: "libx264",
  videoPreset: "ultrafast",
  aspectRatio: "16:9",
  zoomDuration: 600,       // ms
  actionDelay: 300,        // ms inserted between every action
  silent: false,
  autoScroll: true,        // scroll elements into view before interacting
  scrollMargin: 120,       // px kept around an element when auto-scrolling
  scrollSpeed: 1500,       // px/s
  cursor: false,           // show the animated cursor overlay
  visitTimeout: 30_000,    // ms for navigation / waitFor
});
```

## Development

```sh
npm install
npm run build         # type-check + emit dist/ with .d.ts
npx tsx my-script.ts  # run a recording script directly
```

## License

MIT © Cam Parry
