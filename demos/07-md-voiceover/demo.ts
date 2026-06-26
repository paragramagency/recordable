// Demo 7 — Markdown + voiceover, driven programmatically.
//
// Needs an ElevenLabs key — ELEVENLABS_API_KEY, from a .env beside this file
// (Recordable loads it automatically from `baseDir`). Without a key the run
// throws; set RECORDABLE_TTS_PROVIDER=mock to render silent audio instead.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Recordable } from "../../src/index.js";

const dir = dirname(fileURLToPath(import.meta.url));
const md = readFileSync(resolve(dir, "demo.md"), "utf8");

await new Recordable({ baseDir: dir }).fromMarkdown(md).run();
