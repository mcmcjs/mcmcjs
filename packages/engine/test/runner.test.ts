import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  createFitRunner,
  createStreamingRunner,
  type FitProgress,
  interruptGuard,
  killTree,
  parseProgressLine,
} from "../src/runner";

const DETACHED = process.platform !== "win32";

describe("interruptGuard", () => {
  it("registers SIGINT/SIGTERM handlers and removes them on dispose", () => {
    const before = process.listenerCount("SIGINT");
    const beforeTerm = process.listenerCount("SIGTERM");
    // A fake child: the guard only kills it on a signal, which this test never sends.
    const dispose = interruptGuard({ pid: undefined, kill: () => true } as never);
    expect(process.listenerCount("SIGINT")).toBe(before + 1);
    expect(process.listenerCount("SIGTERM")).toBe(beforeTerm + 1);
    dispose();
    expect(process.listenerCount("SIGINT")).toBe(before);
    expect(process.listenerCount("SIGTERM")).toBe(beforeTerm);
  });
});

describe("killTree", () => {
  it("force-kills a running child", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      detached: DETACHED,
      stdio: "ignore",
    });
    const closed = new Promise<void>((res) => child.on("close", () => res()));
    // A live child never closes on its own here; resolution proves the kill worked.
    killTree(child);
    await expect(closed).resolves.toBeUndefined();
  });
});

describe("createStreamingRunner", () => {
  it("resolves on a zero exit (output streamed, not captured)", async () => {
    const run = createStreamingRunner();
    await expect(
      run(process.execPath, ["-e", "process.stderr.write('precompiling...\\n')"]),
    ).resolves.toBe("");
  });

  it("rejects with the exit code on a nonzero exit", async () => {
    const run = createStreamingRunner();
    await expect(run(process.execPath, ["-e", "process.exit(2)"])).rejects.toThrow(
      /exited with code 2/,
    );
  });

  it("rejects when the command cannot be spawned", async () => {
    const run = createStreamingRunner();
    await expect(run("/does/not/exist-mcmcjs", [])).rejects.toThrow();
  });

  it("kills and rejects on timeout", async () => {
    const run = createStreamingRunner(200);
    await expect(run(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"])).rejects.toThrow(
      /timed out/,
    );
  });
});

describe("parseProgressLine", () => {
  it("parses an mcmcjs progress line", () => {
    expect(
      parseProgressLine('{"mcmcjs":"progress","chain":2,"of":4,"fraction":0.45,"done":false}'),
    ).toEqual({ chain: 2, of: 4, fraction: 0.45, done: false });
  });

  it("ignores other stderr content, including other JSON", () => {
    expect(parseProgressLine("Found initial step size")).toBeUndefined();
    expect(parseProgressLine('{"error":"boom","stage":"sample"}')).toBeUndefined();
    expect(parseProgressLine('{"mcmcjs":"other"}')).toBeUndefined();
    expect(parseProgressLine("{not json")).toBeUndefined();
    expect(parseProgressLine("")).toBeUndefined();
  });
});

describe("createFitRunner (streaming)", () => {
  it("routes progress lines to onProgress and keeps them out of stderr", async () => {
    const script = [
      'process.stderr.write(\'{"mcmcjs":"progress","chain":1,"of":2,"fraction":0.5,"done":false}\\n\');',
      "process.stderr.write('plain note\\n');",
      'process.stderr.write(\'{"mcmcjs":"progress","chain":1,"of":2,"fraction":1,"done":true}\\n\');',
      'process.stderr.write(\'{"error":"boom","stage":"sample"}\\n\');',
      'process.stdout.write(\'{"julia_version":"1.12.6"}\\n\');',
      "process.exit(3);",
    ].join("");
    const events: FitProgress[] = [];
    const run = createFitRunner();
    const result = await run(process.execPath, ["-e", script], {
      onProgress: (p) => events.push(p),
    });

    expect(events).toEqual([
      { chain: 1, of: 2, fraction: 0.5, done: false },
      { chain: 1, of: 2, fraction: 1, done: true },
    ]);
    expect(result.code).toBe(3);
    expect(result.stdout).toContain('"julia_version"');
    expect(result.stderr).toContain("plain note");
    expect(result.stderr).toContain('"error":"boom"');
    expect(result.stderr).not.toContain('"mcmcjs"');
  });

  it("flushes a final stderr line without a trailing newline", async () => {
    const run = createFitRunner();
    const result = await run(process.execPath, ["-e", "process.stderr.write('tail');"]);
    expect(result.stderr).toBe("tail\n");
    expect(result.code).toBe(0);
  });

  it("reports a spawn failure as code 1 with the message", async () => {
    const run = createFitRunner();
    const result = await run("/does/not/exist-mcmcjs", []);
    expect(result.code).toBe(1);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it("kills the process on timeout and says so", async () => {
    const run = createFitRunner();
    const result = await run(process.execPath, ["-e", "setTimeout(() => {}, 60_000);"], {
      timeoutMs: 200,
    });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("timed out");
  });
});
