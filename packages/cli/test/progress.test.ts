import { describe, expect, it } from "vitest";
import { createProgressRenderer } from "../src/progress";

function collect(): { out: string[]; write: (text: string) => void } {
  const out: string[] = [];
  return { out, write: (text) => out.push(text) };
}

describe("createProgressRenderer start indicator", () => {
  it("shows a starting line (tty) that the first progress overwrites and finish clears", () => {
    const { out, write } = collect();
    const r = createProgressRenderer({ tty: true, write });
    r.start?.();
    expect(out[0]).toMatch(/^\rstarting Julia/);
    r.onProgress({ chain: 1, of: 4, fraction: 0.5, done: false });
    // The bar line is padded to overwrite the longer "starting" text.
    expect((out[1] as string).length).toBeGreaterThanOrEqual((out[0] as string).length - 1);
    r.finish();
    expect(out.at(-1) as string).toMatch(/^\r +\r$/);
  });

  it("prints a plain starting line when not a tty", () => {
    const { out, write } = collect();
    createProgressRenderer({ tty: false, write }).start?.();
    expect(out[0]).toBe("starting Julia and loading Turing...\n");
  });
});

describe("createProgressRenderer (tty)", () => {
  it("redraws one status line in place and clears it on finish", () => {
    const { out, write } = collect();
    const r = createProgressRenderer({ tty: true, write });
    r.onProgress({ chain: 1, of: 4, fraction: 0.5, done: false });
    r.onProgress({ chain: 1, of: 4, fraction: 1, done: true });
    r.onProgress({ chain: 2, of: 4, fraction: 0.25, done: false });
    r.finish();

    expect(out[0]).toMatch(/^\rsampling chain 1 of 4 {2}\[#{12}\.{12}\] 50%$/);
    expect(out[1]).toContain("100%");
    expect(out[2]).toContain("chain 2 of 4");
    expect(out[3]).toMatch(/^\r +\r$/);
  });

  it("pads shorter lines so leftovers never show", () => {
    const { out, write } = collect();
    const r = createProgressRenderer({ tty: true, write });
    r.onProgress({ chain: 1, of: 4, fraction: 1, done: true });
    r.onProgress({ chain: 2, of: 4, fraction: 0, done: false });
    expect((out[1] as string).length).toBeGreaterThanOrEqual((out[0] as string).length);
  });
});

describe("createProgressRenderer (plain)", () => {
  it("prints one line per 25% step per chain", () => {
    const { out, write } = collect();
    const r = createProgressRenderer({ tty: false, write });
    for (let f = 0; f <= 100; f += 1) {
      r.onProgress({ chain: 1, of: 2, fraction: f / 100, done: false });
    }
    r.onProgress({ chain: 1, of: 2, fraction: 1, done: true });
    r.onProgress({ chain: 2, of: 2, fraction: 0.6, done: false });
    r.finish();

    expect(out).toEqual([
      "sampling chain 1 of 2: 25%\n",
      "sampling chain 1 of 2: 50%\n",
      "sampling chain 1 of 2: 75%\n",
      "sampling chain 1 of 2: 100%\n",
      "sampling chain 2 of 2: 60%\n",
    ]);
  });
});
