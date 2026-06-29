#!/usr/bin/env node
// Zip the unpacked selector-picker extension into extensions/selector-picker.zip
// for drag-and-drop loading onto chrome://extensions. Uses the system `zip`
// (ships on macOS/Linux).

import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "extensions", "selector-picker");
const out = join(root, "extensions", "selector-picker.zip");

if (!existsSync(srcDir)) {
  console.error(`missing ${srcDir}`);
  process.exit(1);
}

rmSync(out, { force: true });
try {
  // -r recurse, -X drop platform extras, exclude dotfiles (e.g. .DS_Store).
  execFileSync("zip", ["-rX", out, ".", "-x", ".*"], {
    cwd: srcDir,
    stdio: "inherit",
  });
} catch {
  console.error("`zip` failed — is it installed? (macOS/Linux ship it)");
  process.exit(1);
}
console.log(`built ${out}`);
