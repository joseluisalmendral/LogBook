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
      name: string;                // key under mcpServers in .claude/mcp.json
      command: string;             // node abs path
      args: string[];
      env?: Record<string, string>;
    }
  | {
      kind: "slash_command";
      name: string;                // e.g. "logbook:status"
      file_path: string;           // .claude/commands/<name>.md
      body: string;                // template content
    }
  | {
      kind: "skill";
      name: string;                // e.g. "logbook"
      file_path: string;           // .claude/skills/<name>/SKILL.md
      body: string;
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
