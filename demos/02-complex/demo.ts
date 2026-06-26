// Demo 2 — Complex: a multi-page SaaS mini-app (the "Dispatch" shipping tracker).
//
// Exercises the breadth of the API across a real navigation flow:
//   search typing · hover-to-reveal menu · key("Escape") · cross-page nav ·
//   modal dialog · native <select> · table mutation · pause/resume off-camera
//   state setup · zoom · scroll.
//
// Drives the shared demo site in ../site (signin / index / new / label / track /
// reports / settings) — linked static HTML sharing app.css, fully self-contained.
//
// Run in your own terminal (headful so you can watch):
//   npx tsx demos/02-complex/demo.ts
import { fileURLToPath } from "node:url";
import { Recordable } from "../../src/index.js";

const url = (file: string) => new URL(`../site/${file}`, import.meta.url).href;

await new Recordable({
  typingSpeed: 16,
  viewport: { width: 1440, height: 900 },
  outputDir: fileURLToPath(new URL("./output", import.meta.url)),
  outputName: "demo-02-complex",
  outputTimestamp: false,
  actionDelay: 350,
})
  .pause() // skip the initial load
  .visit(url("index.html"))
  .resume()

  // ── Dashboard: search, peek the account menu, focus a metric ────────────────
  .type(".search", "PRC-7K2M9A")
  .clear(".search")
  .hover("#avatar") // reveals the dropdown via :hover
  .wait(900)
  .key("Escape")
  .zoom(1.5, { origin: "#card-toship" })
  .wait(700)
  .resetZoom()

  // ── Navigate to Reports and create one in the modal ─────────────────────────
  .click("text:Reports")
  .waitFor("text:New report")
  .click("#new-report")
  .waitFor("#r-title", { state: "visible" })
  .type("#r-title", "Weekly volume")
  .select("#r-type", "volume")
  .type("#r-desc", "Track shipping volume across all carriers this month.")
  .click("text:Create report")
  .waitFor("text:Report created", { state: "visible" })
  .wait(1400)

  // ── Off-camera: hop to Settings to "prepare" before recording it again ──────
  .pause()
  .click("text:Settings")
  .waitFor("#ws-name")
  .resume()

  // ── Settings: edit fields, flip a toggle, change timezone, save ─────────────
  .clear("#ws-name")
  .type("#ws-name", "Northwind Fulfilment")
  .select("#tz", "london")
  .click("text:Delivery alerts")
  .scroll("bottom")
  .click("text:Save changes")
  .waitFor("text:Settings saved", { state: "visible" })
  .wait(1400)
  .scroll("top")
  .wait(700)
  .run(); // finalises automatically
