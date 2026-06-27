// Demo 11 — Page zoom: the `pageZoom` config, the cursor-alignment manual test.
//
// `pageZoom < 1` reflows the page smaller so more fits on screen (like the
// browser's Ctrl+−). The point of this demo is to confirm the animated cursor
// still lands exactly on each target once the page is zoomed: the cursor is a
// fixed overlay the browser scales together with the content, so it must track
// the real click point at every position on the page.
//
// Watch for: the cursor tip sitting on each field/button it interacts with, and
// every click registering (the field focuses / the label page loads). It also
// fires a transform `zoom()` mid-run to prove pageZoom and the animated zoom
// compose without throwing the cursor off.
//
// Run in your own terminal (headful so you can watch):
//   npx tsx demos/11-page-zoom/demo.ts
import { fileURLToPath } from "node:url";
import { Recordable } from "../../src/index.js";

const newShipment = new URL("../site/new.html", import.meta.url).href;

await new Recordable({
  pageZoom: 0.7, // shrink the page so the whole form fits — the feature under test
  typingSpeed: 16,
  viewport: { width: 1280, height: 800 },
  outputDir: fileURLToPath(new URL("./output", import.meta.url)),
  outputName: "demo-11-page-zoom",
})
  .pause() // skip the initial load
  .visit(newShipment)
  .resume()

  // Sweep the cursor across widely-spread targets: a misaligned overlay shows up
  // immediately as the cursor missing a field it's meant to be typing into.
  .mouse("text:New shipment") // top-left heading
  .wait(300)
  .type("#recipient", "Priya Anand")
  .wait(300)
  .type("#address", "48 Marlow Road")
  .wait(300)
  .type("#postcode", "SW1A 1AA") // right-hand column
  .wait(300)
  .select("#service", "express") // dropdown, mid-page
  .wait(300)

  // Combined with a transform zoom — the cursor must still land on the button.
  .zoom(1.3, { origin: "#createLabel" })
  .wait(300)
  .click("text:Generate label", { waitForNav: true })
  .waitFor("text:Label ready", { state: "visible" })
  .wait(1000)
  .resetZoom()
  .wait(600)
  .run(); // finalises automatically
