/**
 * Vendored Gitleaks-derived redaction rules.
 *
 * License: Apache-2.0 — regexes are adaptations of patterns from
 * https://github.com/gitleaks/gitleaks (© Gitleaks contributors).
 *
 * IMPORTANT: these regexes are vendored adaptations, NOT auto-synced.
 * When updating, review the upstream rule for correctness and document
 * the change in the apply-progress artifact.
 *
 * All patterns use the global (`g`) flag — required by the redactor
 * pipeline which calls regex.exec() in a loop.
 */

export interface RedactionRule {
  /** Gitleaks rule id, kebab-case (e.g. "aws-access-key-id") */
  id: string;
  /** Human-readable description of what the rule matches */
  description: string;
  /**
   * Regex with global flag. Capture group 0 (full match) is the secret span.
   * Must always include /g flag.
   */
  pattern: RegExp;
  /**
   * Optional: if set, the full match's Shannon entropy must exceed this
   * threshold for the match to be considered a secret. Useful for rules
   * that produce many false positives on low-entropy input.
   */
  minEntropy?: number;
}

export const GITLEAKS_RULES: ReadonlyArray<RedactionRule> = [
  // -------------------------------------------------------------------------
  // AWS
  // -------------------------------------------------------------------------
  {
    id: "aws-access-key-id",
    description: "AWS access key ID (AKIA, ABIA, ACCA, ASIA prefixes)",
    pattern: /\b(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    id: "aws-secret-access-key",
    description: "AWS secret access key (40-char base64-ish, context-bounded)",
    // Matches a 40-char base64 token not immediately preceded or followed by
    // another base64 character — reduces false positives on longer tokens.
    pattern: /(?<![A-Za-z0-9/+=])([A-Za-z0-9/+]{40})(?![A-Za-z0-9/+=])/g,
    minEntropy: 4.5,
  },

  // -------------------------------------------------------------------------
  // GCP / Google
  // -------------------------------------------------------------------------
  {
    id: "gcp-service-account-key",
    description: "GCP service account private_key_id field in JSON",
    pattern: /"private_key_id":\s*"[a-f0-9]{40}"/g,
  },
  {
    id: "google-api-key",
    description: "Google API key (AIza prefix)",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },

  // -------------------------------------------------------------------------
  // Azure
  // -------------------------------------------------------------------------
  {
    id: "azure-storage-connection-string",
    description: "Azure Storage connection string (DefaultEndpointsProtocol format)",
    pattern: /DefaultEndpointsProtocol=https?;AccountName=[^;]+;AccountKey=[A-Za-z0-9+/=]{40,}/g,
  },

  // -------------------------------------------------------------------------
  // GitHub
  // -------------------------------------------------------------------------
  {
    id: "github-pat-classic",
    description: "GitHub personal access token (classic, ghp_ prefix)",
    pattern: /\bghp_[A-Za-z0-9]{36}\b/g,
  },
  {
    id: "github-pat-fine-grained",
    description: "GitHub personal access token (fine-grained, github_pat_ prefix)",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{82}\b/g,
  },
  {
    id: "github-oauth",
    description: "GitHub OAuth token (gho_ prefix)",
    pattern: /\bgho_[A-Za-z0-9]{36}\b/g,
  },
  {
    id: "github-app-installation",
    description: "GitHub App installation token (ghu_ prefix)",
    pattern: /\bghu_[A-Za-z0-9]{36}\b/g,
  },
  {
    id: "github-app-user-to-server",
    description: "GitHub App user-to-server token (ghs_ prefix)",
    pattern: /\bghs_[A-Za-z0-9]{36}\b/g,
  },

  // -------------------------------------------------------------------------
  // GitLab
  // -------------------------------------------------------------------------
  {
    id: "gitlab-pat",
    description: "GitLab personal access token (glpat- prefix)",
    pattern: /\bglpat-[A-Za-z0-9_-]{20}\b/g,
  },

  // -------------------------------------------------------------------------
  // Slack
  // -------------------------------------------------------------------------
  {
    id: "slack-bot-token",
    description: "Slack bot token (xoxb- prefix)",
    pattern: /\bxoxb-[0-9]+-[0-9]+-[A-Za-z0-9]+\b/g,
  },
  {
    id: "slack-user-token",
    description: "Slack user token (xoxp- prefix)",
    pattern: /\bxoxp-[0-9]+-[0-9]+-[0-9]+-[A-Fa-f0-9]+\b/g,
  },
  {
    id: "slack-webhook",
    description: "Slack incoming webhook URL",
    pattern: /\bhttps:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+\b/g,
  },

  // -------------------------------------------------------------------------
  // Stripe
  // NOTE: Stripe rules must appear BEFORE the openai-api-key rule so that
  // sk_live_ and rk_live_ prefixes are matched by Stripe rules first.
  // The openai rule uses a negative lookbehind to avoid matching sk_live_.
  // -------------------------------------------------------------------------
  {
    id: "stripe-secret-key-live",
    description: "Stripe secret key (live mode, sk_live_ prefix)",
    pattern: /\bsk_live_[A-Za-z0-9]{24,99}\b/g,
  },
  {
    id: "stripe-restricted-key-live",
    description: "Stripe restricted key (live mode, rk_live_ prefix)",
    pattern: /\brk_live_[A-Za-z0-9]{24,99}\b/g,
  },
  {
    id: "stripe-publishable-key-live",
    description: "Stripe publishable key (live mode, pk_live_ prefix)",
    pattern: /\bpk_live_[A-Za-z0-9]{24,99}\b/g,
  },

  // -------------------------------------------------------------------------
  // Anthropic — must appear BEFORE generic openai rule to claim sk-ant- span
  // -------------------------------------------------------------------------
  {
    id: "anthropic-api-key",
    description: "Anthropic API key (sk-ant- prefix, 80+ chars)",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{80,}\b/g,
  },

  // -------------------------------------------------------------------------
  // OpenAI — uses negative lookbehind to avoid matching Stripe sk_live_ etc.
  // Matches sk- followed by 32+ alphanum/underscore/dash chars, but NOT
  // if immediately preceded by "_" (which would indicate sk_live_ was the
  // real prefix). Since JS regex doesn't support variable-length lookbehind
  // in all engines, we post-filter: rule is applied and the redactor
  // removes hits that are already covered by the stripe-secret-key-live rule.
  // The ordering in GITLEAKS_RULES (Stripe before OpenAI) ensures that
  // stripe keys are claimed first during overlap-merge in redactor.ts.
  // -------------------------------------------------------------------------
  {
    id: "openai-api-key",
    description: "OpenAI API key (sk- prefix, 32+ chars, excludes Stripe sk_live_)",
    // sk- followed by 32+ word-like chars; the underscore guard prevents matching
    // sk_live_ and rk_live_ because those have an underscore right after "sk".
    // Note: sk-ant- (Anthropic) is also excluded because Anthropic rule runs first
    // and overlap-merge in redactor.ts will keep the first rule's match.
    pattern: /\bsk-[A-Za-z0-9_-]{32,}\b/g,
  },

  // -------------------------------------------------------------------------
  // npm
  // -------------------------------------------------------------------------
  {
    id: "npm-access-token",
    description: "npm access token (npm_ prefix)",
    pattern: /\bnpm_[A-Za-z0-9]{36}\b/g,
  },

  // -------------------------------------------------------------------------
  // PEM / PKI
  // -------------------------------------------------------------------------
  {
    id: "pem-private-key",
    description: "PEM-encoded private key block (RSA, EC, DSA, OPENSSH, PGP, etc.)",
    // Uses [\s\S]*? (non-greedy dotall) to match multiline key blocks.
    // The (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED |) portion makes the type prefix optional.
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED |)PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED |)PRIVATE KEY-----/g,
  },

  // -------------------------------------------------------------------------
  // JWT — three base64url segments separated by dots
  // -------------------------------------------------------------------------
  {
    id: "jwt",
    description: "JSON Web Token (three-segment base64url header.payload.signature)",
    pattern: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  },

  // -------------------------------------------------------------------------
  // Firebase
  // -------------------------------------------------------------------------
  {
    id: "firebase-cloud-messaging-server-key",
    description: "Firebase Cloud Messaging server key (AAAA prefix)",
    pattern: /\bAAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{140}\b/g,
  },

  // -------------------------------------------------------------------------
  // Email service providers
  // -------------------------------------------------------------------------
  {
    id: "mailchimp-api-key",
    description: "Mailchimp API key (32-char hex + datacenter suffix)",
    pattern: /\b[a-f0-9]{32}-us\d{1,2}\b/g,
  },
  {
    id: "mailgun-api-token",
    description: "Mailgun API token (key- prefix + 32-char hex)",
    pattern: /\bkey-[a-f0-9]{32}\b/g,
  },
  {
    id: "sendgrid-api-key",
    description: "SendGrid API key (SG. prefix, two base64url segments)",
    pattern: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g,
  },

  // -------------------------------------------------------------------------
  // Telecom / messaging
  // -------------------------------------------------------------------------
  {
    id: "twilio-api-key",
    description: "Twilio API key (SK prefix + 32-char hex)",
    pattern: /\bSK[a-f0-9]{32}\b/g,
  },
  {
    id: "discord-bot-token",
    description: "Discord bot token (MFA or non-MFA format)",
    // Format: [MN][23 base64] . [6 word-chars] . [27 word-chars]
    pattern: /\b[MN][A-Za-z0-9]{23}\.[\w-]{6}\.[\w-]{27}\b/g,
  },

  // -------------------------------------------------------------------------
  // Payment / commerce
  // -------------------------------------------------------------------------
  {
    id: "square-access-token",
    description: "Square access token (EAAA prefix)",
    pattern: /\bEAAA[A-Za-z0-9_-]{60}\b/g,
  },

  // -------------------------------------------------------------------------
  // Project management
  // -------------------------------------------------------------------------
  {
    id: "linear-api-key",
    description: "Linear API key (lin_api_ prefix)",
    pattern: /\blin_api_[A-Za-z0-9]{40}\b/g,
  },
] as const;
