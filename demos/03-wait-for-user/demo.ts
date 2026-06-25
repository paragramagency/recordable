// Demo 3 — Wait-for-user: recording behind a manual step (a login).
//
// The pattern: keep the camera OFF (`pause()`) while you sign in by hand, then
// `resumeOnInput()` injects an in-page ▶ Play button and blocks until you click
// it (Enter in the terminal also works). The login never appears in the video;
// recording starts the moment you hit Play.
//
// MUST run headful so the Chrome window is interactive. Run in your own terminal:
//   npx tsx demos/03-wait-for-user/demo.ts
//
// What to do when it launches:
//   1. Type anything into the email/password fields and click "Sign in"
//      (this navigates to app.html — still off-camera).
//   2. Click the ▶ Play button that appears, to start recording.
import { fileURLToPath } from "node:url";
import { Recordable } from "../../src/index.js";

const url = (file: string) => new URL(`./${file}`, import.meta.url).href;

await new Recordable({
  cursor: true,
  headless: false, // interactive window for the manual sign-in
  typingSpeed: 16,
  viewport: { width: 1280, height: 800 },
  outputDir: fileURLToPath(new URL("./output", import.meta.url)),
  outputName: "demo-03-wait-for-user",
  outputTimestamp: false,
})
  .pause() // camera off — the login below is NOT recorded
  .visit(url("login.html"))
  .resumeOnInput("Sign in by hand, then click ▶ Play to start recording")

  // ── Authenticated: everything below is what lands in the video ──────────────
  .waitFor("text:Good afternoon") // we're now on app.html
  .scroll("text:Recent activity")
  .wait(600)
  .zoom(1.4, { origin: "text:Recent activity" })
  .wait(900)
  .resetZoom()
  .scroll("top")
  .wait(800)
  .run(); // finalises automatically
