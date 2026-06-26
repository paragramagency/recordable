// ─── Config ──────────────────────────────────────────────────────────────────

export interface RecordableConfig {
  /** Browser viewport dimensions. Default: 1920×1080 */
  viewport?: { width: number; height: number };
  /** Recording frame rate. Default: 30 */
  fps?: number;
  /** Output directory. Relative paths resolve against `baseDir`. Default: output */
  outputDir?: string;
  /** Where generated voiceover audio is written (voiceover documents only).
   *  Relative paths resolve against `baseDir`. Default: assets */
  assetsDir?: string;
  /** Base filename (without extension or timestamp). Default: recordable */
  outputName?: string;
  /** Prepend an ISO timestamp to the filename. Default: true */
  outputTimestamp?: boolean;
  /** Run without a visible browser window. Default: false */
  headless?: boolean;
  /** Extra Chromium flags appended to the launch args, e.g. `["--no-sandbox"]`
   *  for CI / containers / sandboxed environments. Default: [] */
  launchArgs?: string[];
  /** Typing speed in characters per second. Higher = faster. Default: 7 */
  typingSpeed?: number;
  /** Constant Rate Factor — lower = better quality, larger file. Default: 18 */
  videoCrf?: number;
  /** FFmpeg video codec. Default: libx264 */
  videoCodec?: string;
  /** FFmpeg encoding preset. Default: ultrafast */
  videoPreset?: string;
  /** Default zoom transition duration in ms. Default: 600 */
  zoomDuration?: number;
  /** Automatic pause inserted between every action in ms. Default: 300 */
  actionDelay?: number;
  /** Suppress all console output. Default: false */
  silent?: boolean;
  /** Automatically scroll an element into view before clicking or typing. Default: true */
  autoScroll?: boolean;
  /** Minimum viewport margin (px) kept above/below element when auto-scrolling. Default: 120 */
  scrollMargin?: number;
  /** Auto-scroll speed in px/s — faster = snappier short scrolls. Default: 1500 */
  scrollSpeed?: number;
  /** Show an animated cursor overlay that moves to elements before interacting. Default: true */
  cursor?: boolean;
  /** Timeout in ms for page navigation. Default: 30000 */
  visitTimeout?: number;
  /** Directory that relative `visit` URLs, `outputDir`, and `assetsDir` resolve
   *  against (e.g. the script file's folder). Default: unset → resolve against cwd. */
  baseDir?: string;
}

/**
 * Voiceover settings, carried in Markdown frontmatter (non-secret only — the API
 * key comes from the environment). Consumed by the optional voiceover add-on;
 * core only needs the type to round-trip frontmatter.
 */
export interface VoiceoverConfig {
  /** TTS backend. Omit to take `RECORDABLE_TTS_PROVIDER` (default: elevenlabs). */
  provider?: string;
  /** Voice to synthesize with. Omit to take `RECORDABLE_VOICE_ID`. */
  voiceId?: string;
  /** Omit to take `RECORDABLE_MODEL_ID`, else the provider default. */
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

/** The full config with every field resolved — what the running instance holds. */
export type ResolvedConfig = Required<RecordableConfig>;

/** Default values for every config option. */
export const DEFAULT_CONFIG: ResolvedConfig = {
  viewport: { width: 1920, height: 1080 },
  fps: 30,
  outputDir: "output",
  assetsDir: "assets",
  outputName: "recordable",
  outputTimestamp: true,
  headless: false,
  launchArgs: [],
  typingSpeed: 7,
  videoCrf: 18,
  videoCodec: "libx264",
  videoPreset: "ultrafast",
  zoomDuration: 600,
  actionDelay: 300,
  silent: false,
  autoScroll: true,
  scrollMargin: 120,
  scrollSpeed: 1500,
  cursor: true,
  visitTimeout: 30_000,
  baseDir: "",
};
