// Demo 8 — Showcase: a complete, narrated product walkthrough.
//
// The flow lives in demo.md — narration prose with inline action markers, topped
// and tailed with branded title cards (intro.mp4 / outro.mp4, baked once by
// make-cards.mjs and spliced in with `insert()`). Voiceover synthesis computes
// the waits so each action lands on its narrated word.
//
// Needs an ElevenLabs key — ELEVENLABS_API_KEY, from a .env beside this file
// (loaded automatically from `baseDir`). Without a key the run throws; set the
// voiceover provider to `mock` (in frontmatter) to render silent audio instead.
//
// Regenerate the title cards (one-off):  node demos/08-showcase/make-cards.mjs
// Run (headful, in your own terminal):   npx tsx demos/08-showcase/demo.ts
//   …or via the CLI:                     node dist/cli.js demos/08-showcase/demo.md
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Recordable } from "../../src/index.js";

const dir = dirname(fileURLToPath(import.meta.url));
const md = readFileSync(resolve(dir, "demo.md"), "utf8");

await new Recordable({ baseDir: dir }).fromMarkdown(md).run();
