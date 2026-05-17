export interface ProviderEntry {
  kind: "anthropic" | "openai" | "azure" | "google" | "local" | "codex-cli";
  model: string;                           // provider-specific model id
  base_url?: string;                       // override for self-hosted gateways
  api_key_env: string;                     // env var name (never the key itself)
  max_tokens?: number;                     // optional ceiling
  temperature?: number;                    // optional generation temperature
}

export type ProviderRef = string;          // key into ProvidersConfig.providers

export interface ProvidersConfig {
  default_provider: ProviderRef;           // fallback when no by_phase / by_task hit
  providers: Record<string, ProviderEntry>;// keyed by user-chosen alias
  by_phase: Record<string, ProviderRef>;   // phase name → provider alias
  by_task: Record<string, ProviderRef>;    // task name → provider alias
}
