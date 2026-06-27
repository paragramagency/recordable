// Demo 10 — Container scroll: scrolling WITHIN a fixed-height overflow pane.
//
// The Activity page (../site/activity.html) has a `#feed` panel shorter than its
// content, so it owns its own scrollbar independent of the page. This exercises
// `scroll(target, { container })`: the named container moves while the window
// stays put — covering every target form (child selector, "bottom", "top", and
// an absolute scrollTop). A plain `.scroll()` at the end scrolls the page itself,
// for contrast.
//
// Run in your own terminal (headful so you can watch):
//   npx tsx demos/10-container-scroll/demo.ts
import { fileURLToPath } from "node:url";
import { Recordable } from "../../src/index.js";

const page = new URL("../site/activity.html", import.meta.url).href;
const feed = "#feed"; // the scroll container

await new Recordable({
  viewport: { width: 1280, height: 800 },
  outputDir: fileURLToPath(new URL("./output", import.meta.url)),
  outputName: "demo-10-container-scroll",
  outputTimestamp: false,
  actionDelay: 350,
})
  .pause() // skip the initial load
  .visit(page)
  .resume()

  .zoom(1.2, { origin: feed })
  .wait(500)

  // Walk down the feed — each event is centred inside the pane, page unmoved.
  .scroll("#evt-7", { container: feed })
  .wait(700)
  .scroll("#evt-12", { container: feed })
  .wait(700)

  // Jump to the very end of the pane, then a precise scrollTop, then back to top.
  .scroll("bottom", { container: feed })
  .wait(700)
  .scroll(120, { container: feed })
  .wait(700)
  .scroll("top", { container: feed })
  .wait(700)

  .resetZoom()
  // For contrast: no container → the whole page scrolls instead of the pane.
  .scroll("bottom")
  .wait(800)
  .run(); // finalises automatically
