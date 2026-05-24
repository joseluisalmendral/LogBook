/**
 * Export subsystem barrel.
 *
 * Slice 10 rewrote the HTML export as a Svelte-bundle injector (`./html.ts`)
 * driving the vendored `UI_BUNDLE`. Slice 19 deleted the legacy multi-page
 * shell (build-html-document / inline-css / inline-js / markdown-to-html)
 * together with the `instructor-pack` + `pdf` commands that depended on it.
 */

export { exportHtml } from "./html.js";
export type { ExportOptions } from "./html.js";
export { sanitizeReport, assertNoExternalRefs } from "./sanitize-links.js";
export type { SanitizeReport } from "./sanitize-links.js";
export { UI_BUNDLE, UI_BUNDLE_SHA256 } from "./ui-bundle.js";
export { sanitizeForSafeExport } from "./safe.js";
export type { SafeExportOptions } from "./safe.js";
