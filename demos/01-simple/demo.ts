// Demo 1 — Simple: a single-page newsletter signup.
//
// Exercises the core happy path: visit → zoom → type → click → result.
// Mockup is local + static, so the capture is fully self-contained.
//
// Run in your own terminal (headful so you can watch):
//   npx tsx demos/01-simple/demo.ts
import { fileURLToPath } from "node:url";
import { Recordable } from "../../src/index.js";

const page = new URL("./index.html", import.meta.url).href;

await new Recordable({
  cursor: true,
  typingSpeed: 14,
  viewport: { width: 1280, height: 800 },
  outputDir: fileURLToPath(new URL("./output", import.meta.url)),
  outputName: "demo-01-simple",
  outputTimestamp: false,
})
  .pause() // skip the initial load
  .visit(page)
  .resume()

  .zoom(1.4, { origin: "#email" })
  .type("#email", "hello@studio.com")
  .wait(400)
  .click("text:Subscribe")
  .waitFor("text:You're in", { state: "visible" })
  .wait(1200)
  .resetZoom()
  .wait(800)
  .run(); // finalises automatically
