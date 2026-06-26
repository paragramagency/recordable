// Demo 4 — Insert: splice external clips into the timeline, with cross-fades.
//
// `insert(path, { fadeIn, fadeOut })` ends the current segment, normalizes the
// clip to the recording's resolution / fps / codec, and appends it. Position =
// role: first call = intro, last = outro, in between = mid-roll. No pause/resume
// around it — recording resumes on the next action automatically.
//
// fadeIn / fadeOut (ms) cross-fade the clip with the neighbouring footage, or
// fade from/to black at the timeline ends:
//   intro   — fadeIn dissolves up from black,  fadeOut dissolves into the page
//   midroll — both sides dissolve to/from the recorded footage
//   outro   — fadeIn dissolves from the page,  fadeOut dissolves down to black
//
// The recorded footage drives the shared Dispatch site in ../site; the spliced
// clips live alongside this script and are referenced as local files — insert()
// normalizes them, so they need not match the viewport going in.
//
// Run in your own terminal (headful so you can watch):
//   npx tsx demos/04-insert/demo.ts
import { fileURLToPath } from "node:url";
import { Recordable } from "../../src/index.js";

const page = new URL("../site/index.html", import.meta.url).href;
const clip = (name: string) =>
  fileURLToPath(new URL(`./${name}`, import.meta.url));

await new Recordable({
  viewport: { width: 1280, height: 800 },
  outputDir: fileURLToPath(new URL("./output", import.meta.url)),
  outputName: "demo-04-insert",
  outputTimestamp: false,
})
  .insert(clip("intro.mp4"), { fadeOut: 600 }) // plays first

  .pause() // skip the page load
  .visit(page)
  .resume()

  .zoom(1.3, { origin: "#card-toship" })
  .wait(800)
  .resetZoom()
  .click("text:New shipment")
  .wait(600)

  .insert(clip("midroll.mp4"), { fadeIn: 600, fadeOut: 600 }) // mid-roll

  .type("#recipient", "Priya Anand")
  .wait(400)
  .select("#service", "express")
  .wait(600)
  .click("text:Generate label")
  .waitFor("text:Label ready", { state: "visible" })
  .wait(800)

  .insert(clip("outro.mp4"), { fadeIn: 600 }) // plays last
  .run(); // finalises automatically
