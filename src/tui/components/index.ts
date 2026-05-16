/**
 * Barrel re-export for src/tui/components.
 * Exports all 4 reusable Ink components + their pure formatter helpers.
 */

export { TokenBudgetBar, formatTokenBar } from "./token-budget-bar.js";
export type { TokenBudgetBarProps } from "./token-budget-bar.js";

export { KeybindingsFooter, formatKeybindingsLine } from "./keybindings-footer.js";
export type { KeybindingsFooterProps, KeyBinding } from "./keybindings-footer.js";

export { Breadcrumb, formatBreadcrumb } from "./breadcrumb.js";
export type { BreadcrumbProps } from "./breadcrumb.js";

export { ModalConfirm } from "./modal-confirm.js";
export type { ModalConfirmProps } from "./modal-confirm.js";
