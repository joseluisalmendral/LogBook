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
    label: "Claude subscription (claude-agent-sdk)",
    description:
      "Uses your active Claude Code Pro/Max session — no API key needed, no extra tokens billed. Recommended if you already pay for Claude.",
  },
  {
    value: "api-key" as const,
    label: "API key (Anthropic / OpenAI / Gemini / others)",
    description:
      "Pay-as-you-go via a provider API key (set ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, etc. in your environment). Pick this if you don't have a Claude subscription or want a different provider.",
  },
  {
    value: "disabled" as const,
    label: "Skip for now",
    description:
      "Install LogBook without setting a provider. Summarize/teaching-script commands will be disabled until you run `logbook providers set` later.",
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
// Helper: render the 3-step progress indicator at the top of the wizard
// ---------------------------------------------------------------------------

const STEP_TITLES: Record<1 | 2 | 3, string> = {
  1: "Preset",
  2: "Provider",
  3: "Confirm",
};

/**
 * Visual progress bar showing which wizard step the user is on.
 * Rendered as a single line: `[●] Preset  →  [○] Provider  →  [○] Confirm`
 * The current step is bold cyan; completed steps are dim green with a ✓.
 */
function renderStepProgress(currentStep: 1 | 2 | 3): React.ReactElement {
  const cells: React.ReactNode[] = [];
  for (const s of [1, 2, 3] as const) {
    const isCurrent = s === currentStep;
    const isDone = s < currentStep;
    const marker = isDone ? "✓" : isCurrent ? "●" : "○";
    const color = isDone ? "green" : isCurrent ? "cyan" : undefined;
    cells.push(
      React.createElement(
        Text,
        {
          key: `step-${s}`,
          ...(color !== undefined ? { color } : {}),
          bold: isCurrent,
          dimColor: !isCurrent && !isDone,
        },
        `[${marker}] ${STEP_TITLES[s]}`,
      ),
    );
    if (s < 3) {
      cells.push(
        React.createElement(
          Text,
          { key: `sep-${s}`, dimColor: true },
          "  →  ",
        ),
      );
    }
  }
  return React.createElement(Box, { flexDirection: "row", marginBottom: 1 }, ...cells);
}

// ---------------------------------------------------------------------------
// Helper: render option list with cursor highlight
// ---------------------------------------------------------------------------

function renderOptionList(
  options: Array<{ value: string; label: string; description: string }>,
  cursor: number,
  chosen?: string,
): React.ReactElement[] {
  return options.map((opt, idx) => {
    const isCursor = idx === cursor;
    const isChosen = chosen !== undefined && opt.value === chosen;
    // Three visual states:
    //   "✓ " — the option has already been chosen (saved in choices)
    //   "> " — the cursor is currently on this option
    //   "  " — neither
    // ✓ wins over > so a "previously chosen" option stays visible even when
    // the cursor moves away.
    const prefix = isChosen ? "✓ " : isCursor ? "> " : "  ";
    const colorProp = isChosen
      ? { color: "green" as const }
      : isCursor
        ? { color: "cyan" as const }
        : {};
    return React.createElement(
      Box,
      { key: opt.value, flexDirection: "column", marginBottom: 0 },
      React.createElement(
        Text,
        { bold: isCursor || isChosen, ...colorProp },
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
      React.createElement(Breadcrumb, { path: ["LogBook", "Install"] }),
      renderStepProgress(1),
      React.createElement(
        Box,
        {
          flexDirection: "column",
          borderStyle: "round",
          borderColor: "cyan",
          paddingX: 1,
          paddingY: 0,
        },
        React.createElement(Text, { bold: true }, "Choose a preset"),
        React.createElement(
          Text,
          { dimColor: true },
          "Each preset is a bundle of artifacts. You can change later via `logbook init`.",
        ),
        React.createElement(Text, null, ""),
        ...renderOptionList(PRESET_OPTIONS, cursor, choices.preset),
      ),
      React.createElement(Text, null, ""),
      React.createElement(KeybindingsFooter, { bindings: STEP1_BINDINGS }),
    );
  }

  // --- Step 2: Choose provider
  if (step === 2) {
    return React.createElement(
      Box,
      { flexDirection: "column" },
      React.createElement(Breadcrumb, { path: ["LogBook", "Install"] }),
      renderStepProgress(2),
      React.createElement(
        Box,
        {
          flexDirection: "column",
          borderStyle: "round",
          borderColor: "cyan",
          paddingX: 1,
          paddingY: 0,
        },
        React.createElement(
          Text,
          { dimColor: true },
          `✓ Preset: ${choices.preset ?? "(none)"}`,
        ),
        React.createElement(Text, null, ""),
        React.createElement(Text, { bold: true }, "Choose how LogBook talks to the LLM"),
        React.createElement(
          Text,
          { dimColor: true },
          "Used by `summarize`, `teaching-script`. Doesn't affect event capture.",
        ),
        React.createElement(Text, null, ""),
        ...renderOptionList(PROVIDER_OPTIONS, cursor, choices.provider),
      ),
      React.createElement(Text, null, ""),
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
    React.createElement(Breadcrumb, { path: ["LogBook", "Install"] }),
    renderStepProgress(3),

    // Selections box — green border, summary of what's about to happen
    React.createElement(
      Box,
      {
        flexDirection: "column",
        borderStyle: "round",
        borderColor: "green",
        paddingX: 1,
        paddingY: 0,
      },
      React.createElement(Text, { bold: true }, "Ready to install"),
      React.createElement(Text, null, ""),
      React.createElement(
        Box,
        { flexDirection: "row" },
        React.createElement(Text, { dimColor: true }, "  Preset:    "),
        React.createElement(Text, { bold: true, color: "cyan" }, presetLabel),
      ),
      React.createElement(
        Box,
        { flexDirection: "row" },
        React.createElement(Text, { dimColor: true }, "  Provider:  "),
        React.createElement(Text, { bold: true, color: "cyan" }, providerLabel),
      ),
      React.createElement(Text, null, ""),
      React.createElement(
        Text,
        { dimColor: true },
        `  ${artifactNames.length} artifacts will be installed:`,
      ),
      ...artifactNames.map((name, idx) =>
        React.createElement(
          Text,
          { key: idx, dimColor: true },
          `    • ${name}`,
        ),
      ),
    ),

    React.createElement(Text, null, ""),

    // Action prompt — visually distinct, bright green
    React.createElement(
      Box,
      { flexDirection: "row" },
      React.createElement(Text, { bold: true, color: "green" }, "  ▶ "),
      React.createElement(Text, { bold: true }, "Press "),
      React.createElement(Text, { bold: true, color: "cyan" }, "i"),
      React.createElement(Text, null, " or "),
      React.createElement(Text, { bold: true, color: "cyan" }, "Enter"),
      React.createElement(Text, null, " to install, "),
      React.createElement(Text, { bold: true, color: "cyan" }, "esc"),
      React.createElement(Text, null, " to go back"),
    ),

    React.createElement(Text, null, ""),
    React.createElement(KeybindingsFooter, { bindings: STEP3_BINDINGS }),
  );
}
