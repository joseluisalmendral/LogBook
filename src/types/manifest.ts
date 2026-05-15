export type AnchorSpec =
  | {
      type: "json_field";
      jsonPath: string;        // RFC 6901 JSON Pointer, e.g. "/hooks/PostToolUse/2"
      idField: string;         // key inside object holding the lb-id (e.g. "_logbookId")
      idValue: string;         // lb-id value (e.g. "lb-hook-posttool-001")
      // Set true when HookInstaller created the entire hooks structure (not just the array entry).
      // Used on uninstall to decide whether to remove the hooks key entirely (S7 addition).
      createdHooksStructure?: boolean;
    }
  | {
      type: "markdown_block";
      start_marker: string;    // exact bytes, e.g. "<!-- logbook:generated start v=1 -->"
      end_marker: string;      // exact bytes, e.g. "<!-- logbook:generated end -->"
    }
  | {
      type: "line_set";
      lines: string[];         // exact lines that were appended, without trailing newline
      // Flags recorded from appendLines for byte-identical uninstall (S7 addition).
      addedLeadingNewline?: boolean;
      trailingNewlineAdded?: boolean;
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
  preset: "minimal" | "standard" | "full"; // iter1: only "minimal" honored
  artifacts: ManifestArtifact[];           // every installed artifact
  backups: BackupRef[];                    // every shared file backed up
}
