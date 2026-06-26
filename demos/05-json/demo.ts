// Demo 5 — JSON script: the declarative format driving the same newsletter
// signup as demo 1, authored as data instead of TypeScript.
//
// Runs the JSON programmatically (demo 6 runs the same kind of file through the
// `recordable` CLI instead). `baseDir` is the script's folder: Recordable
// resolves the relative `visit` URL and `outputDir` against it — a bare `.json`
// can't compute paths itself.
//
// Run in your own terminal (headful so you can watch):
//   npx tsx demos/05-json/demo.ts                 # defaults to ./demo.json
//   npx tsx demos/05-json/demo.ts path/to/other.json
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Recordable, type Script } from "../../src/index.js";

const file = resolve(process.argv[2] ?? fileURLToPath(new URL("./demo.json", import.meta.url)));
const script = JSON.parse(readFileSync(file, "utf8")) as Script;

await new Recordable({ baseDir: dirname(file) }).fromJSON(script).run();
