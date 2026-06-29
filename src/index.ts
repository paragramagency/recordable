export { Recordable } from "./compose/recordable.js";
export { ACTIONS, callToAction, validateAction } from "./actions.js";
export type { Action } from "./actions.js";
export type { Script } from "./script.js";
export { fromJSON, runScript } from "./formats/json.js";
export { buildSchema } from "./schema.js";
export { parseMarkdown } from "./formats/markdown/parse.js";
export type {
  ParsedMarkdown,
  MarkdownBlock,
  NarrationBlock,
  ActionsBlock,
} from "./formats/markdown/parse.js";
export type {
  RecordableConfig,
  RecordableInput,
  VoiceoverConfig,
  AudioOptions,
  InsertOptions,
  WaitForOptions,
  ResolvedConfig,
} from "./config.js";
export type { RecordableResult, RecordableFile } from "./result.js";
