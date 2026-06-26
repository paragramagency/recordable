// One-off generator for the showcase intro / outro title cards.
//
// These are *external* clips that demo.ts splices in with `insert()` — baked
// once and committed alongside the demo, not re-rendered every run. Uses the
// ffmpeg bundled with the package (no system install needed):
//
//   node demos/08-showcase/make-cards.mjs
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const FFMPEG = require("@ffmpeg-installer/ffmpeg").path;
const here = (name) => fileURLToPath(new URL(`./${name}`, import.meta.url));

// First font that exists wins (paths differ across machines).
const pick = (...candidates) => candidates.find((p) => existsSync(p)) ?? "";
const BOLD = pick(
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/Library/Fonts/Arial Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
);
const REG = pick(
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/Library/Fonts/Arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
);
if (!BOLD || !REG) {
  console.error("make-cards: no usable TTF font found — edit the candidate list.");
  process.exit(1);
}

const W = 1280;
const H = 800;
const SECONDS = 3;

// Brand palette (matches the Dispatch demo site — demos/site/app.css).
const BG = "0x0f172a"; //     slate-900
const ACCENT = "0x4f46e5"; // indigo-600
const TEXT = "0xf8fafc"; //   slate-50
const MUTED = "0x94a3b8"; //  slate-400

const text = (font, str, size, color, y) =>
  `drawtext=fontfile=${font}:text='${str}':fontcolor=${color}:fontsize=${size}:x=(w-text_w)/2:y=${y}`;

const cards = {
  "intro.mp4": [
    `drawbox=x=(iw-76)/2:y=232:w=76:h=76:color=${ACCENT}@0.95:t=fill`,
    text(BOLD, "Dispatch", 84, TEXT, 336),
    text(REG, "Ship, label, track — in minutes.", 30, MUTED, 452),
  ].join(","),
  "outro.mp4": [
    text(BOLD, "Dispatch", 78, TEXT, 286),
    text(REG, "Every parcel, tracked end to end.", 30, MUTED, 402),
    text(REG, "dispatch.app", 22, ACCENT, 690),
  ].join(","),
};

for (const [name, filters] of Object.entries(cards)) {
  const out = here(name);
  const args = [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=${BG}:s=${W}x${H}:r=30`,
    "-t", String(SECONDS),
    "-vf", `${filters},format=yuv420p`,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    out,
  ];
  const res = spawnSync(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"] });
  if (res.status !== 0) {
    console.error(`make-cards: ffmpeg failed for ${name}`);
    console.error(res.stderr?.toString());
    process.exit(1);
  }
  console.log(`wrote ${name}`);
}
