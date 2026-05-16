/**
 * Breadcrumb component — renders a › separated navigation path.
 *
 * Uses React.createElement (no JSX) to match src/review/tui.ts pattern.
 */

import React from "react";
import { Text } from "ink";

// ---------------------------------------------------------------------------
// Pure formatter (exported for unit testing without Ink)
// ---------------------------------------------------------------------------

/**
 * Format a path array into a breadcrumb string.
 * Example: ["LogBook", "Install", "Step 2 of 3"] → "LogBook › Install › Step 2 of 3"
 */
export function formatBreadcrumb(path: string[]): string {
  return path.join(" › ");
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BreadcrumbProps {
  /** e.g. ["LogBook", "Install", "Step 2 of 3"] */
  path: string[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders the breadcrumb as a single bold Text line at the top of each screen.
 * Example output: LogBook › Install › Step 2 of 3
 */
export function Breadcrumb(props: BreadcrumbProps): React.ReactElement {
  return React.createElement(Text, { bold: true }, formatBreadcrumb(props.path));
}
