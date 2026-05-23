/**
 * Integration test: MCP server boot via stdio.
 *
 * Strategy: raw JSON-RPC 2.0 over stdio (no SDK client needed for T7).
 *
 * Protocol:
 *  1. Spawn dist/mcp/server.cjs
 *  2. Send MCP initialize handshake (required before tools/list per MCP spec)
 *  3. Send initialized notification
 *  4. Send tools/list request
 *  5. Assert response has 4 tools (T8a: decision/error/fix/lesson; T8b will add 5 more)
 *  6. Send SIGTERM; assert process exits within 2s
 *
 * The test builds the bundle in beforeAll to validate build correctness.
 * Build output: dist/mcp/server.cjs
 */

import { describe, it, expect, beforeAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const PROJECT_ROOT = join(import.meta.dirname, "..", "..");
const SERVER_BUNDLE = join(PROJECT_ROOT, "dist", "mcp", "server.cjs");

// Build is run by pnpm pretest:e2e for e2e suite.
// For integration: only build if the server bundle does not already exist.
// Parallel builds with clean:true cause a race where one build wipes dist/
// while other integration tests (CLI-based) are reading from it.
// In CI, `pnpm build` runs before the test suite; in local dev, the first
// integration run triggers a build; subsequent runs reuse the existing dist/.
beforeAll(async () => {
  if (!existsSync(SERVER_BUNDLE)) {
    const result = spawnSync("pnpm", ["build"], {
      cwd: PROJECT_ROOT,
      stdio: "pipe",
      timeout: 60_000,
    });
    if (result.status !== 0) {
      throw new Error(
        `pnpm build failed:\nstdout: ${result.stdout?.toString()}\nstderr: ${result.stderr?.toString()}`,
      );
    }
  }
}, 90_000);

/**
 * Send a line of JSON over stdin and wait for a line of JSON on stdout.
 * Rejects if no response arrives within timeoutMs.
 */
function sendAndReceive(
  proc: ReturnType<typeof spawn>,
  msg: object,
  timeoutMs = 5000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for response to: ${JSON.stringify(msg)}`));
    }, timeoutMs);

    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      // Last element may be incomplete; keep it in buf.
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          clearTimeout(timer);
          proc.stdout?.removeListener("data", onData);
          resolve(parsed);
          return;
        } catch {
          // Not JSON yet — accumulate.
        }
      }
    };

    proc.stdout?.on("data", onData);
    proc.stdin?.write(JSON.stringify(msg) + "\n");
  });
}

describe("mcp-boot", () => {
  it("dist/mcp/server.cjs exists after build", () => {
    expect(existsSync(SERVER_BUNDLE)).toBe(true);
  });

  it("server responds to tools/list with 10 tools (T8a+T8b+B5) and exits cleanly on SIGTERM", async () => {
    const proc = spawn("node", [SERVER_BUNDLE], {
      cwd: PROJECT_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });


    // Capture stderr for debugging on failure.
    const stderrChunks: Buffer[] = [];
    proc.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    try {
      // Step 1: MCP initialize handshake.
      const initResponse = await sendAndReceive(proc, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test-client", version: "0.0.1" },
        },
      });

      expect(initResponse).toMatchObject({
        jsonrpc: "2.0",
        id: 1,
        result: {
          serverInfo: { name: "logbook-mcp" },
        },
      });

      // Step 2: Send initialized notification (no response expected).
      proc.stdin?.write(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
          params: {},
        }) + "\n",
      );

      // Step 3: List tools.
      // T8a: decision/error/fix/lesson (4 tools).
      // T8b: resource/milestone/phase/suggest/state (5 more).
      // B5 (ux-granularity): qa_finding (1 more).
      // Total: 10 tools.
      const listResponse = await sendAndReceive(proc, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      });

      const listResult = (listResponse as { result?: { tools?: Array<{ name: string }> } })
        .result;
      expect(listResult).toBeDefined();
      const toolNames = (listResult?.tools ?? []).map((t) => t.name);
      // T8a tools
      expect(toolNames).toContain("logbook_decision");
      expect(toolNames).toContain("logbook_error");
      expect(toolNames).toContain("logbook_fix");
      expect(toolNames).toContain("logbook_lesson");
      // T8b tools
      expect(toolNames).toContain("logbook_resource");
      expect(toolNames).toContain("logbook_milestone");
      expect(toolNames).toContain("logbook_phase");
      expect(toolNames).toContain("logbook_suggest");
      expect(toolNames).toContain("logbook_state");
      // B5 tool
      expect(toolNames).toContain("logbook_qa_finding");
      // 10 total (T8a: 4 + T8b: 5 + B5: 1)
      expect(toolNames.length).toBe(10);

      // Step 4: SIGTERM — assert clean exit within 2s.
      await new Promise<void>((resolve, reject) => {
        const exitTimer = setTimeout(() => {
          proc.kill("SIGKILL");
          reject(
            new Error(
              `Server did not exit within 2s after SIGTERM\nstderr: ${stderrChunks.map((c) => c.toString()).join("")}`,
            ),
          );
        }, 2000);

        proc.once("exit", (code, signal) => {
          clearTimeout(exitTimer);
          if (code === 0 || signal === "SIGTERM") {
            resolve();
          } else {
            reject(
              new Error(
                `Unexpected exit: code=${code} signal=${signal}\nstderr: ${stderrChunks.map((c) => c.toString()).join("")}`,
              ),
            );
          }
        });

        proc.kill("SIGTERM");
      });
    } catch (err) {
      proc.kill("SIGKILL");
      const stderr = stderrChunks.map((c) => c.toString()).join("");
      throw new Error(`${String(err)}\nServer stderr:\n${stderr}`);
    }
  }, 30_000);

  it("server starts successfully when spawned with --project-root <tmpDir> (Req 1.2)", async () => {
    // Create a temp dir that looks like a project root so bootstrapMcpContext succeeds.
    const tmpProjectDir = mkdtempSync(join(tmpdir(), "lb-mcp-boot-pr-"));
    try {
      writeFileSync(join(tmpProjectDir, "package.json"), JSON.stringify({ name: "test" }) + "\n");
      mkdirSync(join(tmpProjectDir, ".logbook"), { recursive: true });

      // Spawn the server WITHOUT relying on cwd — pass --project-root explicitly.
      const proc = spawn(
        "node",
        [SERVER_BUNDLE, "--project-root", tmpProjectDir],
        {
          cwd: tmpdir(), // intentionally NOT the project root
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      const stderrChunks: Buffer[] = [];
      proc.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

      try {
        // Send MCP initialize — if bootstrap succeeded, the server responds.
        const initResponse = await sendAndReceive(proc, {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "test-client", version: "0.0.1" },
          },
        });

        expect(initResponse).toMatchObject({
          jsonrpc: "2.0",
          id: 1,
          result: {
            serverInfo: { name: "logbook-mcp" },
          },
        });

        // Clean shutdown.
        await new Promise<void>((resolve, reject) => {
          const exitTimer = setTimeout(() => {
            proc.kill("SIGKILL");
            reject(new Error("Server did not exit within 2s after SIGTERM"));
          }, 2000);
          proc.once("exit", (code, signal) => {
            clearTimeout(exitTimer);
            if (code === 0 || signal === "SIGTERM") resolve();
            else reject(new Error(`Unexpected exit: code=${code} signal=${signal}`));
          });
          proc.kill("SIGTERM");
        });
      } catch (err) {
        proc.kill("SIGKILL");
        const stderr = stderrChunks.map((c) => c.toString()).join("");
        throw new Error(`${String(err)}\nServer stderr:\n${stderr}`);
      }
    } finally {
      rmSync(tmpProjectDir, { recursive: true, force: true });
    }
  }, 30_000);
});
