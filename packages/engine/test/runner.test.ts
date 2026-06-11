import { describe, expect, it } from "vitest";
import { createFitRunner, type FitProgress, parseProgressLine } from "../src/runner";

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
