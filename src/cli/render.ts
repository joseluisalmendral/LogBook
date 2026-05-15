/**
 * Plain ASCII table and key-value renderer for the LogBook CLI.
 *
 * No colors or ANSI escape codes in iter1 — plain stdout only.
 * iter2 may add consola/picocolors.
 */

export interface TableColumn {
  header: string;
  width?: number;
  align?: "left" | "right";
}

/**
 * Render a fixed-width ASCII table.
 *
 * If column.width is not specified, the column is sized to fit the
 * widest value (header or any cell).
 */
export function renderTable(columns: TableColumn[], rows: string[][]): string {
  if (columns.length === 0) return "";

  // Compute column widths.
  const widths: number[] = columns.map((col, i) => {
    const base = col.width ?? col.header.length;
    const maxCell = rows.reduce((max, row) => {
      const cell = row[i] ?? "";
      return Math.max(max, cell.length);
    }, 0);
    return Math.max(base, maxCell);
  });

  const sep = widths.map((w) => "-".repeat(w)).join("-+-");
  const header = columns
    .map((col, i) => col.header.padEnd(widths[i]!))
    .join(" | ");

  const lines: string[] = [header, sep];

  for (const row of rows) {
    const line = columns
      .map((col, i) => {
        const cell = row[i] ?? "";
        const w = widths[i]!;
        return col.align === "right" ? cell.padStart(w) : cell.padEnd(w);
      })
      .join(" | ");
    lines.push(line);
  }

  return lines.join("\n") + "\n";
}

/**
 * Render a two-column key: value list.
 */
export function renderKv(pairs: [string, string][]): string {
  if (pairs.length === 0) return "";
  const maxKey = pairs.reduce((max, [k]) => Math.max(max, k.length), 0);
  return (
    pairs.map(([k, v]) => `${k.padEnd(maxKey)} : ${v}`).join("\n") + "\n"
  );
}

/**
 * Pretty-print JSON.
 */
export function renderJson(data: unknown): string {
  return JSON.stringify(data, null, 2) + "\n";
}
