import * as z from "zod";

// ─── Config ──────────────────────────────────────────────────────────────────
//
// `ConfigSchema` is the single source of truth for the recording config: the
// public input type, the fully-resolved type, the default values, and the
// generated JSON Schema (`schema.ts`) are all derived from it. Each field's
// `.default(...)` is the default; the doc comment above it is the user-facing
// documentation.

/** strictObject so an unknown key (usually a typo) fails validation, matching
 *  the `additionalProperties: false` of the generated config schema. */
export const ConfigSchema = z.strictObject({
  /** Browser viewport dimensions. Default: 1920×1080 */
  viewport: z
    .strictObject({ width: z.number(), height: z.number() })
    .default({ width: 1920, height: 1080 }),
  /** Page zoom applied to every document, like the browser's Ctrl +/−. Reflows
   *  layout, so `<1` shrinks content to fit more on screen and `>1` enlarges it.
   *  Persists across navigations and new tabs. Default: 1 (no zoom). */
  pageZoom: z.number().default(1),
  /** Recording frame rate. Default: 30 */
  fps: z.number().default(30),
  /** Output directory. Relative paths resolve against `baseDir`. Default: output */
  outputDir: z.string().default("output"),
  /** Base filename (without extension or timestamp). Default: recordable */
  outputName: z.string().default("recordable"),
  /** Prepend an ISO timestamp to the filename. Default: true */
  outputTimestamp: z.boolean().default(true),
  /** Where generated voiceover audio is written (voiceover documents only).
   *  Relative paths resolve against `baseDir`. Default: assets */
  assetsDir: z.string().default("assets"),
  /** Run without a visible browser window. Default: false */
  headless: z.boolean().default(false),
  /** Extra Chromium flags appended to the launch args, e.g. `["--no-sandbox"]`
   *  for CI / containers / sandboxed environments. Default: [] */
  launchArgs: z.array(z.string()).default([]),
  /** Browser locale as a BCP-47 tag, e.g. `"fr-FR"`. Sets the Chromium UI
   *  language (`--lang`), `navigator.language` / `navigator.languages`
   *  (`--accept-lang`), and the `Accept-Language` request header, so pages render
   *  and content-negotiate in this locale. Default: "" → no override (use the
   *  system locale). */
  language: z.string().default(""),
  /** Typing speed in characters per second. Higher = faster. Default: 7 */
  typingSpeed: z.number().default(7),
  /** Constant Rate Factor — lower = better quality, larger file. Default: 18 */
  videoCrf: z.number().default(18),
  /** FFmpeg video codec. Default: libx264 */
  videoCodec: z.string().default("libx264"),
  /** FFmpeg encoding preset. Default: ultrafast */
  videoPreset: z.string().default("ultrafast"),
  /** Default zoom transition duration in ms. Default: 600 */
  zoomDuration: z.number().default(600),
  /** Automatic pause inserted between every action in ms. Default: 300 */
  actionDelay: z.number().default(300),
  /** Suppress all console output. Default: false */
  silent: z.boolean().default(false),
  /** Automatically scroll an element into view before clicking or typing. Default: true */
  autoScroll: z.boolean().default(true),
  /** Minimum viewport margin (px) kept above/below element when auto-scrolling. Default: 120 */
  scrollMargin: z.number().default(120),
  /** Auto-scroll speed in px/s — faster = snappier short scrolls. Default: 1500 */
  scrollSpeed: z.number().default(1500),
  /** Default `scroll` action transition duration in ms. Default: 1200 */
  scrollDuration: z.number().default(1200),
  /** Show an animated cursor overlay that moves to elements before interacting. Default: true */
  cursor: z.boolean().default(true),
  /** Timeout in ms for page navigation. Default: 30000 */
  visitTimeout: z.number().default(30_000),
  /** Trim the dead time a same-tab navigation spends loading out of the clip:
   *  `visit` and a `waitForNav` click seal the segment, load off-camera, then
   *  resume — so the video cuts straight from action to result and the load
   *  duration never advances the recorded timeline (deterministic narration
   *  timing). Override per click with `click(t, { trimNavigation: false })`.
   *  Default: true */
  trimNavigation: z.boolean().default(true),
  /** Directory that relative `visit` URLs, `outputDir`, and `assetsDir` resolve
   *  against (e.g. the script file's folder). Default: "" → resolve against cwd. */
  baseDir: z.string().default(""),
});

/** Public config input — every field optional (defaults fill the rest). */
export type RecordableConfig = z.input<typeof ConfigSchema>;

/**
 * The full constructor input: recording config plus the reserved sibling keys —
 * `variables` (the top-priority programmatic layer) and discovery overrides
 * (`configFile` / `envFile`, the CLI's `--config` / `--env-file`). Mirrors the
 * flat shape of `recordable.config.json` and Markdown frontmatter.
 */
export interface RecordableInput extends RecordableConfig {
  /** Variables defined here win over every file/document source. */
  variables?: Record<string, string>;
  /** Use exactly this `recordable.config.json`, skipping auto-discovery. */
  configFile?: string;
  /** Use exactly this `.env`, skipping auto-discovery. */
  envFile?: string;
}

/** The full config with every field resolved — what the running instance holds. */
export type ResolvedConfig = z.output<typeof ConfigSchema>;

/** Default values for every config option (the schema's defaults, resolved). */
export const DEFAULT_CONFIG: ResolvedConfig = ConfigSchema.parse({});

/**
 * Voiceover settings, carried in Markdown frontmatter (non-secret only — the API
 * key comes from the environment). Consumed by the optional voiceover add-on;
 * core only needs the type to round-trip frontmatter.
 */
export interface VoiceoverConfig {
  /** TTS backend. Omit to take `DEFAULT_TTS_PROVIDER` (default: elevenlabs). */
  provider?: string;
  /** Voice to synthesize with. Omit to take `DEFAULT_VOICE_ID`. */
  voiceId?: string;
  /** Omit to take `DEFAULT_MODEL_ID`, else the provider default. */
  modelId?: string;
  /** Prefer `ELEVENLABS_API_KEY` in the environment over inlining a key here. */
  apiKey?: string;
  voiceSettings?: Record<string, number>;
  format?: string;
}

/** Options for `Recordable.insert`. Cross-fade durations are in milliseconds. */
export interface InsertOptions {
  /**
   * Cross-fade *into* the clip over this many ms — dissolves from the preceding
   * recorded segment, or fades up from black when the clip is first (an intro).
   * Default: 0 (hard cut).
   */
  fadeIn?: number;
  /**
   * Cross-fade *out of* the clip over this many ms — dissolves into the
   * following recorded segment, or fades to black when the clip is last (an
   * outro). Default: 0 (hard cut).
   */
  fadeOut?: number;
}

/** Options for `Recordable.audio`. */
export interface AudioOptions {
  /**
   * Block the chain until the clip finishes playing (an implicit `wait` for the
   * clip's duration), so following actions land after it. Default: true. Set
   * false for voiceover, where the clip plays *over* interleaved actions whose
   * timing you (or the compiler) control with explicit `wait`s.
   */
  wait?: boolean;
  /** Linear gain applied to the clip (1 = unchanged). Default: 1. */
  volume?: number;
}

/** Options for `Recordable.click`. */
export interface ClickOptions {
  /**
   * Whether the click triggers a full-page navigation to wait for. Default: false
   * — the click returns immediately. Set true to assert a full-page navigation:
   * the wait is armed *before* the click (so a fast commit can't be missed) and
   * the navigation must land, like `visit`. For SPA route changes or async content
   * there is no full-page nav — use a following `waitFor("<selector>")` instead.
   */
  waitForNav?: boolean;
  /** Navigation timeout in ms for `waitForNav: true`. Default: the `visitTimeout` config. */
  timeout?: number;
  /**
   * Override the `trimNavigation` config for this click only. With `waitForNav`,
   * `true` trims the page-load dead time off-camera and `false` keeps it in the
   * clip. No effect without `waitForNav` (a non-navigating click trims nothing).
   * Default: the `trimNavigation` config value.
   */
  trimNavigation?: boolean;
  /**
   * Follow a link that opens in a *new tab* — continue recording in the new tab,
   * which becomes the active page for following actions. The old tab is left open.
   * The loading stretch is trimmed: capture stops at the click and restarts once the
   * new tab has loaded. Default: false. (For a same-tab navigation use `waitForNav`.)
   */
  followNewTab?: boolean;
}

/** Options for `Recordable.waitFor`. */
export interface WaitForOptions {
  /**
   * What to wait for:
   * - `"visible"` (default) — element is present *and* rendered
   * - `"hidden"`            — element is absent or not rendered
   * - `"present"`           — element is attached to the DOM (may be hidden)
   */
  state?: "visible" | "hidden" | "present";
  /** Timeout in ms. Default: the `visitTimeout` config value. */
  timeout?: number;
}
