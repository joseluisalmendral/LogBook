/**
 * Export subsystem barrel (T12, T7, iter5).
 *
 * export-replan P5: `exportHtml` is now the gutted Svelte-bundle injector
 * (≤80 LoC, see `./html.ts`). The legacy inline-css / inline-js / build-
 * html-document / markdown-to-html modules remain for the `instructor-pack`
 * multi-page export (a separate artifact NOT touched by slice 10). The
 * rich Svelte UI is vendored as `UI_BUNDLE` from `./ui-bundle`.
 */

export { exportHtml } from "./html.js";
export type { ExportOptions } from "./html.js";
export { sanitizeReport, assertNoExternalRefs } from "./sanitize-links.js";
export type { SanitizeReport } from "./sanitize-links.js";
export { UI_BUNDLE, UI_BUNDLE_SHA256 } from "./ui-bundle.js";
export { INLINE_CSS } from "./inline-css.js";
export { sanitizeForSafeExport } from "./safe.js";
export type { SafeExportOptions } from "./safe.js";
export { exportInstructorPack, collectBundle, generateToc, rewriteDocLinks } from "./instructor-pack.js";
export type { InstructorPackOptions, BundleSection, BundleContents } from "./instructor-pack.js";
