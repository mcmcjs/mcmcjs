import { describe, expect, it } from "vitest";
import { createCollapsingRunner, detectPhase } from "../src/install-progress";

describe("detectPhase", () => {
  it("maps juliaup/Pkg lines to coarse phases", () => {
    expect(detectPhase("  Resolving package versions...", "")).toBe("resolving packages");
    expect(detectPhase("   Installed FillArrays v1.16.0", "resolving packages")).toBe(
      "downloading",
    );
    expect(detectPhase("  Installing Julia 1.12.6", "")).toBe("installing Julia");
    expect(detectPhase("Precompiling packages...", "downloading")).toBe("precompiling");
    expect(detectPhase("    Updating `~/env/Manifest.toml`", "")).toBe("updating environment");
  });

  it("keeps the current phase when a line matches nothing", () => {
    expect(detectPhase("  [fce5fe82] + Turing v0.45.0", "precompiling")).toBe("precompiling");
    expect(detectPhase("random chatter", "")).toBe("");
  });
});

describe("createCollapsingRunner (non-tty)", () => {
  const node = (body: string): [string, string[]] => [process.execPath, ["-e", body]];

  it("prints a header and one line per phase change, then resolves", async () => {
    const out: string[] = [];
    const run = createCollapsingRunner({
      label: "preparing",
      timeoutMs: 60_000,
      isTTY: false,
      write: (t) => out.push(t),
    });
    const [cmd, args] = node(
      "console.error('Resolving package versions...'); console.error('Precompiling packages...');",
    );
    await expect(run(cmd, args)).resolves.toBe("");
    expect(out[0]).toBe("preparing...\n");
    expect(out).toContain("  resolving packages...\n");
    expect(out).toContain("  precompiling...\n");
  });

  it("on failure prints the captured tail so the real error is visible", async () => {
    const out: string[] = [];
    const run = createCollapsingRunner({
      label: "preparing",
      timeoutMs: 60_000,
      isTTY: false,
      write: (t) => out.push(t),
    });
    const [cmd, args] = node("console.error('ERROR: it broke'); process.exit(1);");
    await expect(run(cmd, args)).rejects.toThrow(/exited with code 1/);
    expect(out.join("")).toContain("ERROR: it broke");
  });

  it("kills and rejects on timeout", async () => {
    const run = createCollapsingRunner({
      label: "x",
      timeoutMs: 200,
      isTTY: false,
      write: () => {},
    });
    const [cmd, args] = node("setTimeout(() => {}, 60_000)");
    await expect(run(cmd, args)).rejects.toThrow(/timed out/);
  });
});

describe("createCollapsingRunner (tty)", () => {
  it("shows a live window of recent output and erases the region on success", async () => {
    const out: string[] = [];
    const run = createCollapsingRunner({
      label: "preparing",
      timeoutMs: 60_000,
      isTTY: true,
      columns: 80,
      rows: 24,
      write: (t) => out.push(t),
    });
    await run(process.execPath, [
      "-e",
      "console.error('Resolving package versions'); console.error('Precompiling MyPkg');",
    ]);
    const all = out.join("");
    // The real log lines were shown live (the header carries the phase).
    expect(all).toContain("Resolving package versions");
    expect(all).toContain("preparing: precompiling");
    // The region is cleared on success: the final write is a clear-to-end-of-display.
    const esc = String.fromCharCode(27);
    const last = out.at(-1) ?? "";
    expect(last.endsWith(`${esc}[0J`)).toBe(true);
    // Nothing is left drawn after the clear.
    expect(last).not.toContain("preparing");
  });

  it("dumps the captured tail on failure (region cleared first)", async () => {
    const out: string[] = [];
    const run = createCollapsingRunner({
      label: "preparing",
      timeoutMs: 60_000,
      isTTY: true,
      columns: 80,
      rows: 24,
      write: (t) => out.push(t),
    });
    await expect(
      run(process.execPath, ["-e", "console.error('ERROR: boom'); process.exit(1);"]),
    ).rejects.toThrow(/exited with code 1/);
    expect(out.at(-1)).toContain("ERROR: boom");
  });
});
