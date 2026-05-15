/**
 * Capture-only context for --dry-run mode.
 *
 * Installers receive a DryRunContext and call ctx.plan(...) instead of
 * performing real I/O when dry-run is active. The context accumulates all
 * planned operations and can render them as an ASCII table or JSON.
 *
 * Integration with installers (S6b/S7): installers check a boolean flag
 * (e.g. `if (options.dryRun)`) and call `dryRunCtx.plan(...)` instead of
 * actually writing files.
 */

export type DryRunPlannedOp =
  | { kind: "write_file"; path: string; bytes_added: number; preview?: string }
  | { kind: "remove_file"; path: string }
  | { kind: "backup_file"; src: string; dst: string }
  | { kind: "mkdir"; path: string };

export class DryRunContext {
  readonly operations: DryRunPlannedOp[] = [];

  plan(op: DryRunPlannedOp): void {
    this.operations.push(op);
  }

  /** Multi-line ASCII table for CLI display. */
  renderTable(): string {
    if (this.operations.length === 0) {
      return "(no operations planned)";
    }

    const rows = this.operations.map((op) => {
      switch (op.kind) {
        case "write_file":
          return { kind: op.kind, detail: `${op.path} (+${op.bytes_added} bytes)` };
        case "remove_file":
          return { kind: op.kind, detail: op.path };
        case "backup_file":
          return { kind: op.kind, detail: `${op.src} → ${op.dst}` };
        case "mkdir":
          return { kind: op.kind, detail: op.path };
      }
    });

    // Column widths
    const kindWidth = Math.max(4, ...rows.map((r) => r.kind.length));
    const detailWidth = Math.max(6, ...rows.map((r) => r.detail.length));

    const sep = `+${"-".repeat(kindWidth + 2)}+${"-".repeat(detailWidth + 2)}+`;
    const header = `| ${"KIND".padEnd(kindWidth)} | ${"DETAIL".padEnd(detailWidth)} |`;
    const lines = rows.map((r) => `| ${r.kind.padEnd(kindWidth)} | ${r.detail.padEnd(detailWidth)} |`);

    return [sep, header, sep, ...lines, sep].join("\n");
  }

  /** JSON array of all planned operations. */
  renderJson(): string {
    return JSON.stringify(this.operations, null, 2);
  }
}
