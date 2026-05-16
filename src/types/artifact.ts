// Discriminated union of every installable artifact kind.
export type Artifact =
  | {
      kind: "hook";
      hookEvent: "PreToolUse" | "PostToolUse" | "Stop" | "SubagentStop" | "SessionStart";
      command: string;             // absolute path to compiled hook bundle
      matcher?: string;            // tool-name regex when Claude Code requires it
      _logbookId: string;          // tag written into the JSON object
    }
  | {
      kind: "mcp_server";
      name: string;                // key under mcpServers in .claude/mcp.json (e.g. "logbook-mcp")
      command: string;             // node abs path (e.g. "node")
      args: string[];              // e.g. ["/abs/dist/mcp/server.cjs"]
      env?: Record<string, string>;
      _logbookId: string;          // lb-id written into the value object (e.g. "lb-mcp-001")
    }
  | {
      kind: "slash_command";
      name: string;                // e.g. "lb-decision"
      file_path: string;           // typically ".claude/commands/<name>.md"
      body: string;                // bundled body content
      _logbookId: string;          // e.g. "lb-cmd-decision"; written into the ManifestArtifact id
    }
  | {
      kind: "skill";
      name: string;                // e.g. "logbook-auto-capture"
      file_path: string;           // e.g. ".claude/skills/logbook-auto-capture/SKILL.md"
      body: string;                // file content
      _logbookId: string;          // e.g. "lb-skill-auto-capture-main" or "lb-skill-auto-capture-ref"
    }
  | {
      kind: "subagent";
      name: string;                // e.g. "logbook-reviewer"
      file_path: string;           // .claude/agents/<name>.md
      body: string;
    }
  | {
      kind: "augment_claudemd";
      file_path: string;           // typically "CLAUDE.md"
      block_content: string;       // body inside markdown markers
      _logbookId: string;          // e.g. "lb-claudemd-001"; written into the ManifestArtifact id
    }
  | {
      kind: "statusline";
      command: string;             // shell command for statusline output
    }
  | {
      kind: "gitignore_entry";
      file_path: string;           // typically ".gitignore"
      lines: string[];             // exact lines to append
    };
