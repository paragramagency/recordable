// Demo 1 — Simple: the core happy path on the shared Dispatch site.
//
// Exercises: visit → zoom → type → click → result. Fills in a new shipment and
// generates a label. The mockup (../site) is local + static, so the capture is
// fully self-contained.
//
// Run in your own terminal (headful so you can watch):
//   npx tsx demos/01-simple/demo.ts
import { fileURLToPath } from "node:url";
import { Recordable } from "../../src/index.js";

const page = new URL("../site/new.html", import.meta.url).href;

await new Recordable({
  typingSpeed: 14,
  viewport: { width: 1280, height: 800 },
  outputDir: fileURLToPath(new URL("./output", import.meta.url)),
  outputName: "demo-01-simple",
  outputTimestamp: false,
})
  .pause() // skip the initial load
  .visit(page)
  .resume()

  .zoom(1.4, { origin: "#recipient" })
  .type("#recipient", "Priya Anand")
  .wait(400)
  .type("#address", "48 Marlow Road")
  .wait(400)
  .click("text:Generate label", { waitForNav: true })
  .waitFor("text:Label ready", { state: "visible" })
  .wait(1200)
  .resetZoom()
  .wait(800)
  .run(); // finalises automatically
