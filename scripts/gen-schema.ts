// Regenerate the committed JSON Schema from the action manifest.
//   npm run gen:schema
import { writeFileSync } from "node:fs";
import { buildConfigFileSchema, buildSchema } from "../src/schema.js";

for (const [name, build] of [
  ["recordable.schema.json", buildSchema],
  ["recordable.config.schema.json", buildConfigFileSchema],
] as const) {
  const out = new URL(`../${name}`, import.meta.url);
  writeFileSync(out, JSON.stringify(build(), null, 2) + "\n");
  console.log("Wrote", out.pathname);
}
