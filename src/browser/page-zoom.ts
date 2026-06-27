import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── pageZoom: genuine browser page zoom (Ctrl +/−) ──────────────────────────
//
// Only Chrome's HostZoomMap zoom — what Ctrl +/− drives, reached via
// `chrome.tabs.setZoom` — reflows the *painted* window so more CSS content fits
// while keeping a single coordinate space (clicks/cursor land unchanged). The
// alternatives all fail: CSS `zoom` on documentElement splits the coordinate
// space (mouse uses zoomed coords, boundingBox stays unzoomed → clicks miss);
// `setViewport({ deviceScaleFactor })` and `setDeviceMetricsOverride` only scale
// the emulation surface, not the headful window (it clips); `--force-device-scale-factor`
// changes DPR but not layout width (no extra content); and there is no CDP command
// for page zoom. So we ship a tiny throwaway MV3 extension that bakes in the zoom
// factor and re-applies it to every tab on create/navigate, loaded via
// `--load-extension`. Generated per run into a temp dir so the factor is baked in
// (no Puppeteer↔service-worker coordination needed) and cleaned up on close.

export interface ZoomExtension {
  /** Launch args that load the extension. */
  args: string[];
  /** Remove the generated temp directory. */
  cleanup: () => void;
}

// Registers its listeners synchronously at top level (MV3 requirement) and
// re-applies on create + every load — page zoom is per-origin persistent, so this
// covers same-origin navigations and any `followNewTab` tabs.
const background = (zoom: number) => `
const ZOOM = ${zoom};
const apply = (id) => chrome.tabs.setZoom(id, ZOOM).catch(() => {});
chrome.tabs.onCreated.addListener((t) => apply(t.id));
chrome.tabs.onUpdated.addListener((id, info) => {
  if (info.status === "loading" || info.status === "complete") apply(id);
});
chrome.runtime.onInstalled.addListener(() =>
  chrome.tabs.query({}, (tabs) => tabs.forEach((t) => apply(t.id))),
);
`;

/** Generate the bundled page-zoom extension for `zoom` and return its launch args
 *  plus a cleanup. Caller adds `args` to `puppeteer.launch` and calls `cleanup`
 *  once the browser has closed. */
export function createZoomExtension(zoom: number): ZoomExtension {
  const dir = mkdtempSync(join(tmpdir(), "recordable-zoom-"));
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "recordable-page-zoom",
      version: "1.0",
      permissions: ["tabs"],
      host_permissions: ["<all_urls>"],
      background: { service_worker: "bg.js" },
    }),
  );
  writeFileSync(join(dir, "bg.js"), background(zoom));
  return {
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
