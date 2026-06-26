export { Recordable } from "./main.js";
export {
  fromJSON,
  runScript,
  ACTIONS,
  callToStep,
  validateStep,
} from "./script.js";
export type { Script, ScriptStep } from "./script.js";
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
  StepsBlock,
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
