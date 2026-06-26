export { Recordable } from "./compose/recordable.js";
export {
  fromJSON,
  runScript,
  ACTIONS,
  callToAction,
  validateAction,
} from "./script.js";
export type { Script, Action } from "./script.js";
export { buildSchema } from "./schema.js";
export {
  flattenMarkdown,
  parseMarkdown,
  narrationBlock,
  flattenBlocks,
} from "./markdown/parse.js";
export type {
  ParsedMarkdown,
  MarkdownBlock,
  NarrationBlock,
  ActionsBlock,
  Marker,
} from "./markdown/parse.js";
export {
  parseMethodCall,
  parseMethodCalls,
  parseArgList,
  isMethodCall,
} from "./markdown/method.js";
export type { MethodCall } from "./markdown/method.js";
export type {
  RecordableConfig,
  VoiceoverConfig,
  AudioOptions,
  InsertOptions,
  WaitForOptions,
  ResolvedConfig,
} from "./config.js";
