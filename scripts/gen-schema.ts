// Regenerate the committed JSON Schema from the action manifest.
//   npm run gen:schema
import { writeFileSync } from "node:fs";
import { buildSchema } from "../src/schema.js";

const out = new URL("../recordable.schema.json", import.meta.url);
writeFileSync(out, JSON.stringify(buildSchema(), null, 2) + "\n");
console.log("Wrote", out.pathname);
