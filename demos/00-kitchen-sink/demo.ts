// Demo 0 — Kitchen sink: every method, every option, in one place.
//
// This is a REFERENCE, not a runnable walkthrough. It drives no real page and is
// not meant to be executed — it exists so you can see the whole API surface at a
// glance, with every config field and every options bag spelled out alongside its
// default. Copy the bits you need into a real script (see demos 01–06).
//
// It is excluded from the build (tsconfig excludes `demos`), but it still
// typechecks against the live types in `../../src` — so if the API changes and
// this drifts, your editor will say so.
import { Recordable } from "../../src/index.js";

await new Recordable({
  // ── Output ──
  outputDir: "./output", //        directory for the MP4. Default: ./output
  outputName: "recordable", //     base filename, no extension. Default: recordable
  outputTimestamp: true, //        prepend an ISO timestamp to the name. Default: true

  // ── Browser / capture ──
  viewport: { width: 1920, height: 1080 }, // window + recording size. Default: 1920×1080
  pageZoom: 1, //                  browser page zoom (Ctrl +/−); <1 fits more on screen. Default: 1
  fps: 30, //                      recording frame rate. Default: 30
  headless: false, //              run with no visible window. Default: false
  visitTimeout: 30_000, //         navigation timeout (ms). Default: 30000

  // ── Encoding (ffmpeg) ──
  videoCodec: "libx264", //        ffmpeg video codec. Default: libx264
  videoCrf: 18, //                 quality; lower = better/larger. Default: 18
  videoPreset: "ultrafast", //     encoding preset. Default: ultrafast

  // ── Motion / feel ──
  cursor: true, //                 animated cursor overlay before interactions. Default: true
  typingSpeed: 7, //               typing speed, chars/sec. Default: 7
  zoomDuration: 600, //            default zoom transition (ms). Default: 600
  actionDelay: 300, //             automatic pause between every action (ms). Default: 300

  // ── Auto-scroll ──
  autoScroll: true, //             scroll a target into view before click/type. Default: true
  scrollMargin: 120, //            min viewport margin kept around it (px). Default: 120
  scrollSpeed: 1500, //            auto-scroll speed (px/s). Default: 1500

  // ── Console ──
  silent: false, //                suppress all log output. Default: false
})
  // ── Config at runtime ───────────────────────────────────────────────────────
  // Merge config mid-chain; takes effect at this point in the sequence.
  .setConfig({ typingSpeed: 12 })

  // ── Recording control ───────────────────────────────────────────────────────
  // Recording is ON from the top and finalises on run() — there is no start/stop.
  .pause() //                      stop capturing; the chain keeps running off-camera
  .resume() //                     resume capturing immediately, in a fresh segment
  .waitForPlay() //                gate only: block on the ▶ Play button, leave the camera as-is
  .resumeOnPlay() //               wait for ▶ Play, then resume capturing (= waitForPlay().resume())
  .resumeOnPlay("Sign in, then press ▶ Play") // …with a custom prompt message

  // Splice an external clip: first call = intro, last = outro, between = mid-roll.
  .insert("./intro.mp4") //                          hard cut (no fades)
  .insert("./outro.mp4", { fadeIn: 500, fadeOut: 800 }) // cross-fade in/out (ms)

  // ── Navigation ──────────────────────────────────────────────────────────────
  .visit("https://example.com") //                   go to a URL, wait for settle
  .visit("https://example.com", { waitUntil: "load" }) // + any Puppeteer GoToOptions

  // Wait for an element to reach a state (CSS selector or `text:` prefix).
  .waitFor("#app") //                                default state: "visible"
  .waitFor("text:Loading", { state: "hidden" }) //   "visible" | "hidden" | "present"
  .waitFor("#slow", { state: "present", timeout: 10_000 }) // + custom timeout (ms)

  // ── Interactions ────────────────────────────────────────────────────────────
  // Targets accept a CSS selector or a `text:` prefix (matched by visible text).
  .click("#submit") //                               click by selector
  .click("text:Next") //                             click by visible text
  .click("text:Save", { waitForNav: true }) //       wait for a full-page navigation (opt-in)
  .click("text:Save", { waitForNav: true, timeout: 10_000 }) // …with a custom nav timeout (ms)
  .hover("text:Account") //                          reveal :hover state (menus, tooltips)
  .type("#email", "hello@studio.com") //             type with human-like timing
  .type("#title", "My model", { duration: 4000 }) // type deterministically over 4s
  .clear("#email") //                                select-all + delete a field
  .select("#country", "us") //                       pick a <select> option (by value)
  .key("Enter") //                                   press a key: "Escape", "Tab", …
  .mouse("text:Logo") //                             move cursor to an element
  .mouse({ x: 960, y: 540 }) //                      …or to absolute viewport coords

  // ── Scrolling ───────────────────────────────────────────────────────────────
  .scroll("top") //                                  "top" | "bottom"
  .scroll("#features") //                            centre an element (selector/text)
  .scroll(2400) //                                   absolute Y pixel position
  .scroll("bottom", { duration: 2000 }) //           override the animation length (ms)

  // ── Zoom ────────────────────────────────────────────────────────────────────
  .zoom(1.5) //                                      scale up from centre
  .zoom(2, { origin: "#hero" }) //                   origin: selector / `text:` …
  .zoom(2, { origin: "top left" }) //                …CSS keyword(s) …
  .zoom(2, { origin: "50% 25%", duration: 900 }) //  …or percentages, + custom duration
  .resetZoom() //                                    smoothly back to 1×
  .resetZoom({ duration: 400 }) //                   …with a custom duration

  // ── Timing ──────────────────────────────────────────────────────────────────
  .wait(1000) //                                     hold for N ms

  // ── Execution ───────────────────────────────────────────────────────────────
  .run(); //                                         run the queue, finalise the MP4
