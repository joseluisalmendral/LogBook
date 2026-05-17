/**
 * ProvidersScreen — renders the LogBook providers management screen.
 *
 * Single component with sub-mode rendering (one switch on view).
 * Pure function: (state, dispatch) → ReactElement.
 * Uses React.createElement (no JSX) to match project conventions.
 *
 * Views:
 *   list         — list of configured providers; cursor navigation
 *   detail       — selected provider details + actions (T, D)
 *   routing      — task/phase routing table
 *   add          — 3-step wizard to add a provider
 *   confirm-remove — confirm before removing a provider
 *
 * This component is Ink-free for the layout portions; ModalConfirm uses useInput.
 * Re-reads providers.json on each render entry via the shell snapshot refresh
 * (shell.ts dispatches snapshot.refresh on providers screen entry in T5).
 */

import React, { useEffect } from "react";
import * as fs from "node:fs";
import { Box, Text, useInput } from "ink";
import { Breadcrumb, KeybindingsFooter, ModalConfirm } from "../components/index.js";
import { PROVIDERS_KIND_OPTIONS } from "../shell-flows.js";
import { makePaths } from "../../core/paths.js";
import type { ProvidersConfig, ProviderEntry } from "../../types/providers.js";
import type { ShellState, ShellAction } from "../types.js";

// ---------------------------------------------------------------------------
// Providers JSON helpers (re-read on each entry — no shared state)
// ---------------------------------------------------------------------------

const DEFAULT_PROVIDERS_CONFIG: ProvidersConfig = {
  default_provider: "anthropic-claude-sdk",
  providers: {
    "anthropic-claude-sdk": {
      kind: "anthropic",
      model: "claude-sonnet-4-5",
      api_key_env: "ANTHROPIC_API_KEY",
    },
  },
  by_task: {},
  by_phase: {},
};

function readProvidersConfig(projectRoot: string): ProvidersConfig {
  try {
    const paths = makePaths(projectRoot);
    if (!fs.existsSync(paths.providersPath)) return DEFAULT_PROVIDERS_CONFIG;
    const raw = fs.readFileSync(paths.providersPath, "utf-8");
    return JSON.parse(raw) as ProvidersConfig;
  } catch {
    return DEFAULT_PROVIDERS_CONFIG;
  }
}

function saveProvidersConfig(projectRoot: string, cfg: ProvidersConfig): void {
  try {
    const paths = makePaths(projectRoot);
    const dir = paths.logbookDir;
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${paths.providersPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
    fs.renameSync(tmp, paths.providersPath);
  } catch {
    // Fail silently — the doing screen will show an error via dispatch
  }
}

// ---------------------------------------------------------------------------
// Footer bindings per view
// ---------------------------------------------------------------------------

const LIST_BINDINGS = [
  { keys: "j/k", label: "navigate" },
  { keys: "enter", label: "detail" },
  { keys: "r", label: "routing" },
  { keys: "a", label: "add" },
  { keys: "q/esc", label: "back" },
];

const DETAIL_BINDINGS = [
  { keys: "t", label: "test" },
  { keys: "d", label: "remove" },
  { keys: "esc/b", label: "back" },
];

const ROUTING_BINDINGS = [
  { keys: "j/k", label: "navigate" },
  { keys: "esc/b", label: "back" },
];

const ADD_BINDINGS_STEP1 = [
  { keys: "j/k", label: "navigate kind" },
  { keys: "enter", label: "select kind" },
  { keys: "esc", label: "cancel" },
];

const ADD_BINDINGS_STEP2 = [
  { keys: "tab/n", label: "next" },
  { keys: "p", label: "back" },
  { keys: "esc", label: "cancel" },
];

const ADD_BINDINGS_STEP3 = [
  { keys: "enter", label: "confirm" },
  { keys: "p", label: "back" },
  { keys: "esc", label: "cancel" },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ProvidersScreenProps {
  state: ShellState;
  dispatch: (a: ShellAction) => void;
}

// ---------------------------------------------------------------------------
// ProvidersScreen — main component
// ---------------------------------------------------------------------------

export function ProvidersScreen({ state, dispatch }: ProvidersScreenProps): React.ReactElement {
  const { screen, snapshot } = state;

  if (screen.kind !== "providers") {
    return React.createElement(
      Box,
      null,
      React.createElement(Text, { color: "red" }, "ProvidersScreen: invalid screen kind"),
    );
  }

  const projectRoot = snapshot.projectRoot ?? "";
  const cfg = projectRoot ? readProvidersConfig(projectRoot) : DEFAULT_PROVIDERS_CONFIG;
  const providerEntries = Object.entries(cfg.providers);

  const view = screen.view;

  switch (view) {
    case "list":
      return renderList({ screen, cfg, providerEntries, dispatch });
    case "detail":
      return renderDetail({ screen, cfg, dispatch });
    case "routing":
      return renderRouting({ screen, cfg, dispatch });
    case "add":
      return renderAdd({ screen, projectRoot, cfg, dispatch });
    case "confirm-remove":
      return renderConfirmRemove({ screen, dispatch });
    default:
      return React.createElement(Box, null, React.createElement(Text, { color: "red" }, "ProvidersScreen: unknown view"));
  }
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

interface ListProps {
  screen: Extract<import("../types.js").ProvidersScreen, { view: "list" }>;
  cfg: ProvidersConfig;
  providerEntries: [string, ProviderEntry][];
  dispatch: (a: ShellAction) => void;
}

function renderList({ screen, cfg, providerEntries, dispatch }: ListProps): React.ReactElement {
  // Capture key inputs
  useInput((input, key) => {
    if (input === "a" || input === "A") {
      dispatch({ type: "providers.add.start" });
      return;
    }
    if (input === "r" || input === "R") {
      dispatch({ type: "providers.list.routing" });
      return;
    }
    if (key.return) {
      dispatch({ type: "providers.list.select" });
      return;
    }
    if (key.escape || input === "q" || input === "b") {
      dispatch({ type: "back" });
      return;
    }
  });

  const { cursor } = screen;
  const defaultLabel = `default: ${cfg.default_provider}`;

  const items = providerEntries.map(([alias, entry], idx) => {
    const isSelected = idx === cursor;
    const prefix = isSelected ? "> " : "  ";
    const isDefault = alias === cfg.default_provider ? " [default]" : "";
    const label = `${alias}: ${entry.kind}/${entry.model}${isDefault}`;
    const colorProp = isSelected ? { color: "cyan" as const } : {};
    return React.createElement(
      Text,
      { key: alias, bold: isSelected, ...colorProp },
      `${prefix}${label}`,
    );
  });

  if (providerEntries.length === 0) {
    items.push(
      React.createElement(
        Text,
        { key: "empty", dimColor: true },
        "  (no providers configured)",
      ),
    );
  }

  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(Breadcrumb, { path: ["LogBook", "Configure", "Providers"] }),
    React.createElement(Text, { dimColor: true }, "─".repeat(60)),
    React.createElement(Text, { dimColor: true }, defaultLabel),
    React.createElement(Text, { dimColor: true }, "─".repeat(60)),
    React.createElement(Box, { flexDirection: "column", marginTop: 1 }, ...items),
    React.createElement(Text, { dimColor: true }, "─".repeat(60)),
    React.createElement(KeybindingsFooter, { bindings: LIST_BINDINGS }),
  );
}

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------

interface DetailProps {
  screen: Extract<import("../types.js").ProvidersScreen, { view: "detail" }>;
  cfg: ProvidersConfig;
  dispatch: (a: ShellAction) => void;
}

function renderDetail({ screen, cfg, dispatch }: DetailProps): React.ReactElement {
  const { selectedProviderId } = screen;
  const entry = cfg.providers[selectedProviderId];

  useInput((input, key) => {
    if (input === "t" || input === "T") {
      dispatch({ type: "providers.test.invoke", providerId: selectedProviderId });
      return;
    }
    if (input === "d" || input === "D") {
      dispatch({ type: "providers.remove.request", providerId: selectedProviderId });
      return;
    }
    if (key.escape || input === "b") {
      dispatch({ type: "back" });
      return;
    }
  });

  const isDefault = selectedProviderId === cfg.default_provider;

  const rows: React.ReactElement[] = [];
  if (entry) {
    rows.push(React.createElement(Text, { key: "alias" }, `alias:       ${selectedProviderId}`));
    rows.push(React.createElement(Text, { key: "kind" }, `kind:        ${entry.kind}`));
    rows.push(React.createElement(Text, { key: "model" }, `model:       ${entry.model}`));
    rows.push(React.createElement(Text, { key: "api_key_env" }, `api_key_env: ${entry.api_key_env}`));
    if (entry.base_url) {
      rows.push(React.createElement(Text, { key: "base_url" }, `base_url:    ${entry.base_url}`));
    }
    if (isDefault) {
      rows.push(React.createElement(Text, { key: "default", color: "green" }, "  [this is the default provider]"));
    }
  } else {
    rows.push(React.createElement(Text, { key: "notfound", color: "red" }, `Provider not found: ${selectedProviderId}`));
  }

  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(Breadcrumb, { path: ["LogBook", "Configure", "Providers", selectedProviderId] }),
    React.createElement(Text, { dimColor: true }, "─".repeat(60)),
    React.createElement(Box, { flexDirection: "column", marginTop: 1 }, ...rows),
    React.createElement(Text, { dimColor: true }, "─".repeat(60)),
    React.createElement(KeybindingsFooter, { bindings: DETAIL_BINDINGS }),
  );
}

// ---------------------------------------------------------------------------
// Routing view
// ---------------------------------------------------------------------------

interface RoutingProps {
  screen: Extract<import("../types.js").ProvidersScreen, { view: "routing" }>;
  cfg: ProvidersConfig;
  dispatch: (a: ShellAction) => void;
}

function renderRouting({ screen, cfg, dispatch }: RoutingProps): React.ReactElement {
  const { cursor } = screen;

  useInput((_input, key) => {
    if (key.escape) {
      dispatch({ type: "back" });
      return;
    }
  });

  const taskEntries = Object.entries(cfg.by_task);
  const phaseEntries = Object.entries(cfg.by_phase);
  const allEntries = [...taskEntries.map(([k, v]) => ({ scope: "task", key: k, value: v })),
    ...phaseEntries.map(([k, v]) => ({ scope: "phase", key: k, value: v }))];

  const rows = allEntries.map((row, idx) => {
    const isSelected = idx === cursor;
    const prefix = isSelected ? "> " : "  ";
    const colorProp = isSelected ? { color: "cyan" as const } : {};
    return React.createElement(
      Text,
      { key: `${row.scope}-${row.key}`, bold: isSelected, ...colorProp },
      `${prefix}${row.scope}:${row.key} → ${row.value}`,
    );
  });

  if (allEntries.length === 0) {
    rows.push(
      React.createElement(Text, { key: "empty", dimColor: true }, "  (no routing rules configured)"),
    );
  }

  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(Breadcrumb, { path: ["LogBook", "Configure", "Providers", "Routing"] }),
    React.createElement(Text, { dimColor: true }, "─".repeat(60)),
    React.createElement(Text, { dimColor: true }, `default: ${cfg.default_provider}`),
    React.createElement(Text, { dimColor: true }, "─".repeat(60)),
    React.createElement(Box, { flexDirection: "column", marginTop: 1 }, ...rows),
    React.createElement(Text, { dimColor: true }, "─".repeat(60)),
    React.createElement(KeybindingsFooter, { bindings: ROUTING_BINDINGS }),
  );
}

// ---------------------------------------------------------------------------
// Add wizard view
// ---------------------------------------------------------------------------

interface AddProps {
  screen: Extract<import("../types.js").ProvidersScreen, { view: "add" }>;
  projectRoot: string;
  cfg: ProvidersConfig;
  dispatch: (a: ShellAction) => void;
}

function renderAdd({ screen, dispatch }: AddProps): React.ReactElement {
  const { step, fields, cursor } = screen;

  useInput((input, key) => {
    if (key.escape) {
      dispatch({ type: "providers.add.cancel" });
      return;
    }
    if (key.return) {
      if (step === 1) {
        // Select the highlighted kind
        const selected = PROVIDERS_KIND_OPTIONS[cursor];
        if (selected !== undefined) {
          dispatch({ type: "providers.add.setField", field: "kind", value: selected });
          dispatch({ type: "providers.add.next" });
        }
        return;
      }
      if (step === 3) {
        dispatch({ type: "providers.add.commit" });
        return;
      }
    }
  });

  const breadcrumbStep = `Step ${step}/3`;

  if (step === 1) {
    const kindItems = PROVIDERS_KIND_OPTIONS.map((k, idx) => {
      const isSelected = idx === cursor;
      const prefix = isSelected ? "> " : "  ";
      const colorProp = isSelected ? { color: "cyan" as const } : {};
      return React.createElement(Text, { key: k, bold: isSelected, ...colorProp }, `${prefix}${k}`);
    });

    return React.createElement(
      Box,
      { flexDirection: "column" },
      React.createElement(Breadcrumb, { path: ["LogBook", "Configure", "Providers", "Add", breadcrumbStep] }),
      React.createElement(Text, { dimColor: true }, "─".repeat(60)),
      React.createElement(Text, { bold: true }, "Choose provider kind:"),
      React.createElement(Box, { flexDirection: "column", marginTop: 1 }, ...kindItems),
      React.createElement(Text, { dimColor: true }, "─".repeat(60)),
      React.createElement(KeybindingsFooter, { bindings: ADD_BINDINGS_STEP1 }),
    );
  }

  if (step === 2) {
    return React.createElement(
      Box,
      { flexDirection: "column" },
      React.createElement(Breadcrumb, { path: ["LogBook", "Configure", "Providers", "Add", breadcrumbStep] }),
      React.createElement(Text, { dimColor: true }, "─".repeat(60)),
      React.createElement(Text, null, `kind:  ${fields.kind}`),
      React.createElement(Text, null, `name:  ${fields.name || "(type a name)"}`),
      React.createElement(Text, null, `model: ${fields.model || "(type a model id)"}`),
      React.createElement(Text, { dimColor: true }, "Use providers.add.setField to set name/model before proceeding."),
      React.createElement(Text, { dimColor: true }, "─".repeat(60)),
      React.createElement(KeybindingsFooter, { bindings: ADD_BINDINGS_STEP2 }),
    );
  }

  // step 3
  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(Breadcrumb, { path: ["LogBook", "Configure", "Providers", "Add", breadcrumbStep] }),
    React.createElement(Text, { dimColor: true }, "─".repeat(60)),
    React.createElement(Text, null, `kind:    ${fields.kind}`),
    React.createElement(Text, null, `name:    ${fields.name}`),
    React.createElement(Text, null, `model:   ${fields.model}`),
    React.createElement(Text, null, `env var: ${fields.envVar || "(type env var name)"}`),
    React.createElement(Text, { dimColor: true }, "─".repeat(60)),
    React.createElement(KeybindingsFooter, { bindings: ADD_BINDINGS_STEP3 }),
  );
}

// ---------------------------------------------------------------------------
// Confirm-remove view
// ---------------------------------------------------------------------------

interface ConfirmRemoveProps {
  screen: Extract<import("../types.js").ProvidersScreen, { view: "confirm-remove" }>;
  dispatch: (a: ShellAction) => void;
}

function renderConfirmRemove({ screen, dispatch }: ConfirmRemoveProps): React.ReactElement {
  const { providerId } = screen;

  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(Breadcrumb, { path: ["LogBook", "Configure", "Providers", "Remove"] }),
    React.createElement(Text, { dimColor: true }, "─".repeat(60)),
    React.createElement(
      ModalConfirm,
      {
        message: `Remove provider "${providerId}"?`,
        onYes: () => dispatch({ type: "providers.remove.confirm", confirmed: true }),
        onNo: () => dispatch({ type: "providers.remove.confirm", confirmed: false }),
      },
    ),
  );
}

// Export helpers for tests
export { readProvidersConfig, saveProvidersConfig };
