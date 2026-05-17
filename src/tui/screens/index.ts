/**
 * Barrel re-export for src/tui/screens.
 * Exports all 6 screen renderer components used by the shell TUI (iter6 T4).
 */

export { HomeScreen } from "./home.js";
export type { HomeScreenProps } from "./home.js";

export { InstallWizardScreen } from "./install-wizard.js";
export type { InstallWizardScreenProps } from "./install-wizard.js";

export { ConfigureScreen } from "./configure.js";
export type { ConfigureScreenProps } from "./configure.js";

export { ReviewBridgeScreen } from "./review-bridge.js";
export type { ReviewBridgeScreenProps } from "./review-bridge.js";

export { DoingScreen } from "./doing.js";
export type { DoingScreenProps } from "./doing.js";

export { ProvidersScreen } from "./providers.js";
export type { ProvidersScreenProps } from "./providers.js";
