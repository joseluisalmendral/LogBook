/**
 * Mermaid diagram pre-processing pipeline (S2.1).
 *
 * Scans markdown for ```mermaid fenced code blocks, renders each to SVG via
 * the @mermaid-js/mermaid-cli (mmdc) subprocess, sanitizes the SVG, and
 * replaces each fence with an inline <div class="mermaid"><svg>…</svg></div>.
 *
 * This module MUST be called BEFORE the unified/remark/rehype pipeline so that
 * the injected raw HTML div survives. The HTML pipeline must include rehype-raw
 * (after remark-rehype) to pass the raw HTML through to the output.
 *
 * Mock seam: set LOGBOOK_MERMAID_MOCK=1 (or pass opts.mock=true) to skip the
 * mmdc subprocess. Used in all CI/unit/integration tests.
 *
 * Design §6.1 + D4 (build-time SVG render; defense-in-depth sanitization).
 *
 * Dependencies:
 *  - @mermaid-js/mermaid-cli — devDependency (subprocess only, never bundled)
 *  - sanitizeSvg — from ./safe.ts
 */

import { spawn } from "node:child_process";
import { writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { sanitizeSvg } from "./safe.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Regex to detect ```mermaid fenced code blocks in markdown.
 * Captures the diagram body in group 1.
 * Uses the `g` flag to match all occurrences in a document.
 */
const MERMAID_FENCE_RE = /```mermaid\n([\s\S]*?)\n```/g;

/**
 * Mock SVG returned when LOGBOOK_MERMAID_MOCK=1 or opts.mock=true.
 * Trivially passes sanitizeSvg (no external refs, no dangerous elements).
 */
const MOCK_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" data-mermaid-mock="1" viewBox="0 0 100 30">` +
  `<text x="5" y="20">mock mermaid</text>` +
  `</svg>`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Pre-process markdown: replace ```mermaid fences with inline SVG divs.
 *
 * Algorithm:
 * 1. Collect all ```mermaid fences (regex scan).
 * 2. For each fence: render SVG (mock or real), sanitize, wrap in div.
 * 3. Replace all fences in order.
 * 4. Return the transformed markdown (or the original if no fences found).
 *
 * @param markdown  Input markdown string (may contain 0 or more mermaid fences).
 * @param opts      Optional override — pass mock=true to force mock mode.
 * @returns         Markdown with mermaid fences replaced by <div class="mermaid">…</div>.
 */
export async function renderMermaidFences(
  markdown: string,
  opts?: { mock?: boolean }
): Promise<string> {
  const useMock =
    opts?.mock === true ||
    process.env["LOGBOOK_MERMAID_MOCK"] === "1";

  // Collect all fences first (avoid modifying string while iterating).
  const fences: Array<{ match: string; body: string }> = [];
  for (const m of markdown.matchAll(MERMAID_FENCE_RE)) {
    fences.push({ match: m[0], body: m[1] as string });
  }

  if (fences.length === 0) {
    return markdown;
  }

  // Render each fence to a sanitized div.
  const renders: string[] = [];
  for (const fence of fences) {
    const rawSvg = useMock ? MOCK_SVG : await renderSingleMermaid(fence.body);
    const safeSvg = sanitizeSvg(rawSvg);
    renders.push(`<div class="mermaid">${safeSvg}</div>`);
  }

  // Replace fences in order (counter-based replacer).
  let idx = 0;
  return markdown.replace(MERMAID_FENCE_RE, () => renders[idx++] as string);
}

// ---------------------------------------------------------------------------
// Internal: invoke mmdc subprocess
// ---------------------------------------------------------------------------

/**
 * Render a single Mermaid diagram source string to SVG via mmdc.
 *
 * Writes the source to a temp file, invokes `mmdc -i <in> -o <out> -b transparent`,
 * reads the SVG output, and cleans up the temp directory.
 *
 * Throws descriptive errors on:
 *  - ENOENT (mmdc not found) — with install instructions
 *  - Non-zero exit code — with stderr content
 *  - Timeout (30s) — kills process, throws
 *
 * @param source  Mermaid diagram definition string.
 * @returns       Raw SVG string from mmdc output.
 */
export async function renderSingleMermaid(source: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "logbook-mermaid-"));
  const inPath = join(dir, "diagram.mmd");
  const outPath = join(dir, "diagram.svg");

  try {
    await writeFile(inPath, source, "utf8");
    await runMmdc(["-i", inPath, "-o", outPath, "-b", "transparent"]);
    return await readFile(outPath, "utf8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Invoke mmdc with the given args.
 * Resolves when mmdc exits with code 0.
 * Rejects on non-zero exit, ENOENT, or 30s timeout.
 */
function runMmdc(args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // Use `pnpm exec mmdc` or just `mmdc` depending on availability.
    // `npx --no mmdc` avoids accidental install prompts in non-CI envs.
    // We spawn `mmdc` directly — it's a devDep so it's in node_modules/.bin.
    const child = spawn("mmdc", args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    const stderrChunks: Buffer[] = [];
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    // 30s hard timeout
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("mmdc subprocess timed out after 30s"));
    }, 30_000);

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(
          new Error(
            "mmdc not found. Install @mermaid-js/mermaid-cli as a devDependency:\n" +
              "  pnpm add -D @mermaid-js/mermaid-cli"
          )
        );
      } else {
        reject(err);
      }
    });

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
        reject(
          new Error(
            `mmdc exited with code ${code ?? "null"}${stderr ? ": " + stderr : ""}`
          )
        );
      }
    });
  });
}
