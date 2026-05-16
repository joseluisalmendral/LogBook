export type AnchorSpec =
  | {
      type: "json_field";
      jsonPath: string;        // RFC 6901 JSON Pointer, e.g. "/hooks/PostToolUse/2"
      idField: string;         // key inside object holding the lb-id (e.g. "_logbookId")
      idValue: string;         // lb-id value (e.g. "lb-hook-posttool-001")
      // Set true when HookInstaller created the entire hooks structure (not just the array entry).
      // Used on uninstall to decide whether to remove the hooks key entirely (S7 addition).
      createdHooksStructure?: boolean;
      // Set to the hookEvent name when HookInstaller injected the event array key (e.g. "SessionStart")
      // into an existing hooks object. On uninstall, removes that array key via string-patch,
      // preserving all other hooks byte-for-byte (T-FIX-HOOK).
      createdHookEvent?: string;
    }
  | {
      // T4 addition — used by mcp_server installer.
      // Distinguishes from json_field (array-item semantics) by making the parent-is-object
      // case explicit. The idField lives inside the VALUE object, not as the key name itself.
      // T4.D1: We introduced this new variant (rather than reusing json_field) to keep
      // array-item and object-key semantics clearly separate at the type level.
      type: "json_object_key";
      jsonPath: string;        // RFC 6901 Pointer to the inserted KEY itself, e.g. "/mcpServers/logbook-mcp"
      idField: string;         // field inside the value object holding the lb-id (e.g. "_logbookId")
      idValue: string;         // lb-id value (e.g. "lb-mcp-001")
      // Set true when MCPServerInstaller injected the mcpServers key into the file.
      // On uninstall, if true, removes the entire mcpServers key (not just our entry),
      // restoring the file to its pre-install state.
      createdMcpServersKey?: boolean;
      // Set true when MCPServerInstaller created the file from scratch (file was absent).
      // On uninstall, deletes the file entirely.
      createdFile?: boolean;
    }
  | {
      type: "markdown_block";
      start_marker: string;    // exact bytes, e.g. "<!-- logbook:generated start v=1 -->"
      end_marker: string;      // exact bytes, e.g. "<!-- logbook:generated end -->"
      // Set true when ClaudeMdAugmentInstaller created the file from scratch (file was absent).
      // On uninstall, deletes the file entirely if the remaining content is empty/whitespace.
      createdFile?: boolean;
      // Mirrors the upsertMarkdownBlock result flag — used for byte-identical uninstall.
      addedLeadingNewline?: boolean;
    }
  | {
      type: "line_set";
      lines: string[];         // exact lines that were appended, without trailing newline
      // Flags recorded from appendLines for byte-identical uninstall (S7 addition).
      addedLeadingNewline?: boolean;
      trailingNewlineAdded?: boolean;
    }
  | {
      // T6 addition — used by slash_command installer.
      // The entire file IS the artifact; expected_sha256 is sha256 of the file we wrote.
      // On uninstall, refuse to delete if sha256(currentBytes) !== expected_sha256 (user/tool
      // modified the file) — record hash_mismatch issue and skip deletion.
      type: "owned_file";
      expected_sha256: string;
    };

export type ArtifactKindName =
  | "hook"
  | "mcp_server"
  | "slash_command"
  | "skill"
  | "subagent"
  | "augment_claudemd"
  | "statusline"
  | "gitignore_entry";

export interface ManifestArtifact {
  id: string;                              // lb-* tag, globally unique
  kind: ArtifactKindName;                  // discriminator
  file_path: string;                       // project-relative path of the target file
  anchor: AnchorSpec;                      // how to locate this artifact on uninstall
  content_hash: string;                    // sha256 of the inserted bytes (the entry text)
  installed_at: string;                    // RFC3339 UTC
  // iter2 CRLF additions (T3): captured at install for symmetric uninstall.
  // Absent on iter1-installed entries → treated as "lf" (backward compat).
  detectedLineEnding?: "lf" | "crlf" | "mixed";
  // iter2 T6: parent dirs created by owned-file installer, removed on uninstall if empty.
  createdParentDirs?: string[];
  // iter2 T13: origin preset tag. iter4 T8: added "teaching".
  preset?: "minimal" | "standard" | "full" | "teaching";
}

export interface BackupRef {
  file_path: string;                       // project-relative path of the file backed up
  backup_path: string;                     // relative path under .logbook/backups/
  sha256: string;                          // hash of the file at backup time
  taken_at: string;                        // RFC3339 UTC
}

export interface Manifest {
  version: 1;                              // bumped on breaking manifest schema changes
  installed_at: string;                    // RFC3339 UTC of first install
  preset: "minimal" | "standard" | "full" | "teaching"; // iter1: only "minimal" honored; iter4: "teaching" added
  artifacts: ManifestArtifact[];           // every installed artifact
  backups: BackupRef[];                    // every shared file backed up
}
