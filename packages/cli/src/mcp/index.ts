import { spawn } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import type { Command } from "commander";
import { z } from "zod";
import { selfInvocation } from "../self";
import { TOOLS, type ToolSpec } from "./tools";

declare const __MCMC_VERSION__: string;

export interface CommandResult {
  ok: boolean;
  /** The CLI's own exit code: 2 means it ran but a domain check failed. */
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs one mcmc command and captures it. Going through the CLI rather than
 * calling internals keeps the tool honest: an agent sees exactly what a person
 * would, including the exit-code contract.
 */
export function runCli(args: string[], timeoutMs: number): Promise<CommandResult> {
  const self = selfInvocation([...args, "--json"]);
  return new Promise((resolve) => {
    const child = spawn(self.command, self.args, {
      stdio: ["ignore", "pipe", "pipe"],
      // A tool call must never inherit a TTY: the CLI would draw progress bars.
      env: { ...process.env, MCMC_NO_UPDATE_CHECK: "1" },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, code: 1, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * What the model sees. A domain failure (exit 2, most often a fit that did not
 * converge) is returned as content rather than an error: the diagnostics are
 * the useful part, and calling it an error invites a pointless retry.
 */
export function formatResult(
  tool: ToolSpec,
  result: CommandResult,
): {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
} {
  const body = result.stdout.trim();
  if (result.ok || (result.code === 2 && body)) {
    return {
      content: [{ type: "text", text: body || "(no output)" }],
      ...(structured(tool, body) ?? {}),
    };
  }
  const detail = [result.stderr.trim(), body].filter(Boolean).join("\n");
  return {
    content: [
      {
        type: "text",
        text: `${tool.command.join(" ")} exited ${result.code}\n${detail || "(no output)"}`,
      },
    ],
    isError: true,
  };
}

/**
 * The command's JSON as typed data beside the text, so a client can read a
 * field instead of parsing a blob. A command that prints a bare array is
 * wrapped under the tool's key, because structured content is an object.
 * Anything that fails to parse simply has none.
 */
export function structured(
  tool: ToolSpec,
  body: string,
): { structuredContent: Record<string, unknown> } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  const value =
    Array.isArray(parsed) && tool.outputKey
      ? { [tool.outputKey]: parsed }
      : parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
  return value ? { structuredContent: value } : undefined;
}

export function buildServer(): McpServer {
  const server = new McpServer(
    { name: "mcmcjs", version: typeof __MCMC_VERSION__ === "undefined" ? "dev" : __MCMC_VERSION__ },
    {
      instructions:
        "Bayesian modelling with mcmcjs. Write a model file that defines build_model(data), fit it with mcmc_run, then read mcmc_diagnose before trusting any estimate. A verdict of not-converged is information, not a failure. For a model you generated, check it with mcmc_sbc before drawing conclusions from it.",
    },
  );

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: z.object(tool.input),
        outputSchema: tool.output,
        annotations: {
          readOnlyHint: tool.name !== "mcmc_run" && tool.name !== "mcmc_sbc",
          openWorldHint: false,
        },
      },
      async (input: Record<string, unknown>) => {
        const result = await runCli([...tool.command, ...tool.args(input)], tool.timeoutMs);
        return formatResult(tool, result);
      },
    );
  }
  return server;
}

export function registerMcp(program: Command): void {
  program
    .command("mcp")
    .summary("run as an MCP server for an AI assistant")
    .helpGroup("Toolchain:")
    .description(
      "Speak the Model Context Protocol on stdin/stdout, so an assistant can fit models and read diagnostics through mcmc. Add it with: claude mcp add mcmcjs -- mcmc mcp",
    )
    .action(async () => {
      // serveStdio picks the protocol era from the opening exchange, so one
      // server answers both a current client and a 2025-era one.
      const handle = serveStdio(() => buildServer());
      await new Promise<void>((resolve) => {
        const stop = () => {
          void handle.close().finally(resolve);
        };
        process.on("SIGINT", stop);
        process.on("SIGTERM", stop);
        process.stdin.on("close", stop);
      });
    });
}
