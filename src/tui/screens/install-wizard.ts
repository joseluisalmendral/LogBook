/**
 * InstallWizardScreen — 3-step install wizard screen.
 *
 * Pure function: (state, dispatch) → ReactElement.
 * Uses React.createElement (no JSX) to match project conventions.
 *
 * Step 1: Choose preset (minimal | standard | teaching)
 * Step 2: Choose provider (claude-agent-sdk | api-key | disabled)
 * Step 3: Preview artifacts + confirm (Install / Dry-run / Back)
 */

import React from "react";
import { Box, Text } from "ink";
import { Breadcrumb, KeybindingsFooter } from "../components/index.js";
import type { ShellState, ShellAction, Preset } from "../types.js";
import { buildArtifactsForPreset } from "../../core/presets.js";

// ---------------------------------------------------------------------------
// Preset descriptions
// ---------------------------------------------------------------------------

const PRESET_OPTIONS: Array<{ value: Preset; label: string; description: string }> = [
  {
    value: "minimal",
    label: "minimal",
    description: "Core hook + JSONL events only. Minimal token footprint.",
  },
  {
    value: "standard",
    label: "standard",
    description: "Hook + slash commands + MCP server. Recommended for most users.",
  },
  {
    value: "teaching",
    label: "teaching",
    description: "Everything in standard + teaching-specific slash commands.",
  },
];

// ---------------------------------------------------------------------------
// Provider descriptions
// ---------------------------------------------------------------------------

const PROVIDER_OPTIONS = [
  {
    value: "claude-agent-sdk" as const,
    label: "claude-agent-sdk",
    description: "Use the Claude Agent SDK (project-scoped config). Recommended.",
  },
  {
    value: "api-key" as const,
    label: "api-key",
    description: "Use a raw Anthropic API key (env var ANTHROPIC_API_KEY).",
  },
  {
    value: "disabled" as const,
    label: "disabled",
    description: "Skip provider setup now; configure manually later.",
  },
];

// ---------------------------------------------------------------------------
// Footer bindings per step
// ---------------------------------------------------------------------------

const STEP1_BINDINGS = [
  { keys: "j/k", label: "navigate" },
  { keys: "enter", label: "select" },
  { keys: "space/→", label: "next" },
  { keys: "esc", label: "back" },
];

const STEP2_BINDINGS = [
  { keys: "j/k", label: "navigate" },
  { keys: "enter", label: "select" },
  { keys: "space/→", label: "next" },
  { keys: "esc", label: "back" },
];

const STEP3_BINDINGS = [
  { keys: "i", label: "install" },
  { keys: "d", label: "dry-run" },
  { keys: "esc", label: "back" },
];

// ---------------------------------------------------------------------------
// Helper: render option list with cursor highlight
// ---------------------------------------------------------------------------

function renderOptionList(
  options: Array<{ value: string; label: string; description: string }>,
  cursor: number,
): React.ReactElement[] {
  return options.map((opt, idx) => {
    const isSelected = idx === cursor;
    const prefix = isSelected ? "> " : "  ";
    const colorProp = isSelected ? { color: "cyan" as const } : {};
    return React.createElement(
      Box,
      { key: opt.value, flexDirection: "column", marginBottom: 0 },
      React.createElement(
        Text,
        { bold: isSelected, ...colorProp },
        `${prefix}${opt.label}`,
      ),
      React.createElement(
        Text,
        { dimColor: true },
        `    ${opt.description}`,
      ),
    );
  });
}

// ---------------------------------------------------------------------------
// InstallWizardScreen
// ---------------------------------------------------------------------------

export interface InstallWizardScreenProps {
  state: ShellState;
  dispatch: (a: ShellAction) => void;
}

export function InstallWizardScreen({ state, dispatch: _dispatch }: InstallWizardScreenProps): React.ReactElement {
  const { screen } = state;
  if (screen.kind !== "install") {
    return React.createElement(
      Box,
      null,
      React.createElement(Text, { color: "red" }, "InstallWizardScreen: invalid screen kind"),
    );
  }

  const { step, cursor, choices } = screen;

  // --- Step 1: Choose preset
  if (step === 1) {
    return React.createElement(
      Box,
      { flexDirection: "column" },
      React.createElement(Breadcrumb, { path: ["LogBook", "Install", "Step 1 of 3"] }),
      React.createElement(Text, { dimColor: true }, "─".repeat(60)),
      React.createElement(Text, { bold: true }, "Choose a preset:"),
      React.createElement(Text, { dimColor: true }, ""),
      ...renderOptionList(PRESET_OPTIONS, cursor),
      React.createElement(Text, { dimColor: true }, "─".repeat(60)),
      React.createElement(KeybindingsFooter, { bindings: STEP1_BINDINGS }),
    );
  }

  // --- Step 2: Choose provider
  if (step === 2) {
    return React.createElement(
      Box,
      { flexDirection: "column" },
      React.createElement(Breadcrumb, { path: ["LogBook", "Install", "Step 2 of 3"] }),
      React.createElement(Text, { dimColor: true }, "─".repeat(60)),
      React.createElement(
        Text,
        { bold: true },
        `Preset: ${choices.preset ?? "(none)"}`,
      ),
      React.createElement(Text, { bold: true }, "Choose a provider:"),
      React.createElement(Text, { dimColor: true }, ""),
      ...renderOptionList(PROVIDER_OPTIONS, cursor),
      React.createElement(Text, { dimColor: true }, "─".repeat(60)),
      React.createElement(KeybindingsFooter, { bindings: STEP2_BINDINGS }),
    );
  }

  // --- Step 3: Preview + confirm
  // Try to build the artifact list for the selected preset
  let artifactNames: string[] = [];
  if (choices.preset) {
    try {
      const artifacts = buildArtifactsForPreset(choices.preset);
      artifactNames = artifacts.map((a) =>
        "_logbookId" in a ? `${a.kind}:${a._logbookId}` : a.kind,
      );
    } catch {
      artifactNames = ["(could not compute artifacts)"];
    }
  }

  const presetLabel = choices.preset ?? "(no preset selected)";
  const providerLabel = choices.provider ?? "(no provider selected)";

  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(Breadcrumb, { path: ["LogBook", "Install", "Step 3 of 3"] }),
    React.createElement(Text, { dimColor: true }, "─".repeat(60)),
    React.createElement(Text, { bold: true }, "Review and confirm:"),
    React.createElement(Text, null, `  Preset:   ${presetLabel}`),
    React.createElement(Text, null, `  Provider: ${providerLabel}`),
    React.createElement(Text, { dimColor: true }, ""),
    React.createElement(Text, { bold: true }, "Artifacts to install:"),
    ...artifactNames.map((name, idx) =>
      React.createElement(Text, { key: idx }, `  • ${name}`),
    ),
    React.createElement(Text, { dimColor: true }, "─".repeat(60)),
    React.createElement(Text, { bold: true, color: "green" }, "  [i] Install    [d] Dry-run    [esc] Back"),
    React.createElement(KeybindingsFooter, { bindings: STEP3_BINDINGS }),
  );
}
