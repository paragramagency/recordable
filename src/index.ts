export { Recordable } from "./compose/recordable.js";
export { ACTIONS, callToAction, validateAction } from "./actions.js";
export type { Script, Action } from "./actions.js";
export { fromJSON, runScript } from "./formats/json.js";
export { buildSchema } from "./schema.js";
export {
  flattenMarkdown,
  parseMarkdown,
  narrationBlock,
  flattenBlocks,
} from "./formats/markdown/parse.js";
export type {
  ParsedMarkdown,
  MarkdownBlock,
  NarrationBlock,
  ActionsBlock,
  Marker,
} from "./formats/markdown/parse.js";
export {
  parseMethodCall,
  parseMethodCalls,
  parseArgList,
  isMethodCall,
} from "./formats/markdown/method.js";
export type { MethodCall } from "./formats/markdown/method.js";
export type {
  RecordableConfig,
  VoiceoverConfig,
  AudioOptions,
  InsertOptions,
  WaitForOptions,
  ResolvedConfig,
} from "./config.js";
