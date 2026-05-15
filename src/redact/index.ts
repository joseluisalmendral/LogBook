/**
 * Redaction pipeline — public barrel.
 *
 * Import `redact` and related types from here; internal modules should
 * not be imported directly by consumers outside src/redact/.
 */

export { redact } from "./redactor.js";
export type { RedactionHit, RedactionResult, RedactOptions } from "./redactor.js";
export { GITLEAKS_RULES } from "./gitleaks-rules.js";
export type { RedactionRule } from "./gitleaks-rules.js";
export { shannonEntropy } from "./entropy.js";
