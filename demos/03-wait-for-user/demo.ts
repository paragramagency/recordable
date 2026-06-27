// Demo 3 — Wait-for-user: recording behind a manual step (a login).
//
// The pattern: keep the camera OFF (`pause()`) while you sign in by hand, then
// `resumeOnPlay()` injects an in-page ▶ Play button and blocks until you click
// it (Enter in the terminal also works). The login never appears in the video;
// recording starts the moment you hit Play. (`resumeOnPlay()` is just
// `waitForPlay().resume()` — use the standalone `waitForPlay()` gate if you want
// to hold for a manual step without resuming the camera.)
//
// Drives the shared demo site in ../site: sign in by hand on signin.html, then
// the recorded part picks up on the shipments dashboard (index.html).
//
// MUST run headful so the Chrome window is interactive. Run in your own terminal:
//   npx tsx demos/03-wait-for-user/demo.ts
//
// What to do when it launches:
//   1. Type anything into the email/password fields and click "Sign in"
//      (this navigates to index.html — still off-camera).
//   2. Click the ▶ Play button that appears, to start recording.
import { fileURLToPath } from "node:url";
import { Recordable } from "../../src/index.js";

const url = (file: string) => new URL(`../site/${file}`, import.meta.url).href;

await new Recordable({
  headless: false, // interactive window for the manual sign-in
  typingSpeed: 16,
  viewport: { width: 1280, height: 800 },
  outputDir: fileURLToPath(new URL("./output", import.meta.url)),
  outputName: "demo-03-wait-for-user",
  outputTimestamp: false,
})
  .pause() // camera off — the login below is NOT recorded
  .visit(url("signin.html"))
  .resumeOnPlay("Sign in by hand, then click ▶ Play to start recording")

  // ── Authenticated: everything below is what lands in the video ──────────────
  .waitFor("text:Good afternoon") // we're now on the shipments dashboard
  .scroll("text:Recent shipments")
  .wait(600)
  .zoom(1.4, { origin: "text:Recent shipments" })
  .wait(900)
  .resetZoom()
  .scroll("top")
  .wait(800)
  .run(); // finalises automatically
