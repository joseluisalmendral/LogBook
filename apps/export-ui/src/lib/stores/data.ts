/*
 * data store — reads <script id="lb-data"> JSON ONCE at app boot.
 *
 * Design §3 stores; spec R-43 (the JSON placeholder is the only contract
 * between exporter and UI). This module is intentionally NOT a Svelte rune —
 * the payload never changes mid-session (the export is a frozen artifact at
 * file:// time), so a plain `const` is the simpler shape.
 *
 * Failure modes (all degrade to `emptyPayload()` rather than throw):
 *   1. <script id="lb-data"> missing entirely → dev mode, no fixture injected
 *   2. Element present but empty text content → exporter wrote no payload yet
 *   3. JSON parse error → corrupted artifact (rare; logs to console for triage)
 *
 * The UI MUST treat the payload as read-only. Mutating it from any component
 * would create state divergence between, say, sidebar totals and the chapter
 * view.
 */

import type { ExportPayloadV2 } from "../types";
import { emptyPayload } from "../types";
import { setProjectRoot } from "./teaching-prefs";

function readPayloadFromDom(): ExportPayloadV2 {
  if (typeof document === "undefined") {
    // SSR / vitest node env. Use empty payload — tests that need real data
    // should inject a fixture into a stubbed document.
    return emptyPayload();
  }

  const node = document.getElementById("lb-data");
  if (!node) return emptyPayload();

  const raw = node.textContent?.trim();
  if (!raw) return emptyPayload();

  try {
    const parsed = JSON.parse(raw) as Partial<ExportPayloadV2>;
    // Defensive: if the payload version is anything other than 2, fall back.
    if (parsed.version !== 2) {
      // eslint-disable-next-line no-console
      console.warn(
        `lb-data payload version mismatch: expected 2, got ${parsed.version as unknown as string}. Falling back to empty payload.`,
      );
      return emptyPayload();
    }
    // Merge with empty to fill any missing top-level fields without crashing.
    return { ...emptyPayload(), ...parsed } as ExportPayloadV2;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("lb-data payload parse error:", err);
    return emptyPayload();
  }
}

/**
 * Singleton — read once at module evaluation. Subsequent imports return the
 * same object reference, which is important for $derived consumers that want
 * stable identities.
 */
export const payload: ExportPayloadV2 = readPayloadFromDom();

// Slice-27: cache the project root on window so `wrapPathsForBlur` can
// split paths at the project boundary (blur prefix only, keep repo-relative
// portion readable). Pure side-effect at module init; no-op under SSR.
if (typeof window !== "undefined" && payload.project?.root) {
  setProjectRoot(payload.project.root);
}

// Reflect the project name in the browser tab title so renamed presentations
// are recognizable (e.g. "tendr-landing" instead of the static "LogBook
// Export"). SSR / file:// safe — guard on `document`.
if (typeof document !== "undefined") {
  document.title = payload.project?.name || "LogBook Export";
}
