/**
 * Export subsystem barrel (T12, T7, iter5).
 */

export { exportHtml } from "./html.js";
export type { ExportOptions } from "./html.js";
export { sanitizeReport, assertNoExternalRefs } from "./sanitize-links.js";
export type { SanitizeReport } from "./sanitize-links.js";
export { INLINE_CSS } from "./inline-css.js";
export { sanitizeForSafeExport } from "./safe.js";
export type { SafeExportOptions } from "./safe.js";
export { exportInstructorPack, collectBundle, generateToc, rewriteDocLinks } from "./instructor-pack.js";
export type { InstructorPackOptions, BundleSection, BundleContents } from "./instructor-pack.js";
