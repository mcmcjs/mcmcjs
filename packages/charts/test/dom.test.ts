import type UPlot from "uplot";
import { describe, expect, it } from "vitest";
import { type MountSpec, mountPlot } from "../src/dom/index";

// A minimal stand-in for the uPlot constructor: it records what it was built with
// and exposes the surface mountPlot relies on (ctx.canvas, setData, setSize, destroy).
function fakeUplot() {
  const calls = { config: undefined as unknown, data: undefined as unknown, destroyed: false };
  class Fake {
    static paths = {
      bars: (o: unknown) => ({ kind: "bars", o }),
      stepped: (o: unknown) => ({ kind: "stepped", o }),
    };
    ctx = { canvas: { width: 100, height: 50 } };
    constructor(config: unknown, data: unknown, _target: unknown) {
      calls.config = config;
      calls.data = data;
    }
    setData(d: unknown) {
      calls.data = d;
    }
    setSize(_s: unknown) {}
    destroy() {
      calls.destroyed = true;
    }
  }
  return { Fake: Fake as unknown as typeof UPlot, calls };
}

const target = { clientWidth: 600 } as unknown as HTMLElement;

const spec: MountSpec = {
  title: "mu",
  xLabel: "iteration",
  data: [
    [0, 1, 2],
    [1, 2, 3],
  ],
  series: [{ label: "chain 1", stroke: "#1f77b4" }],
};

describe("mountPlot", () => {
  it("throws a clear error when uPlot is not provided", () => {
    expect(() => mountPlot(target, spec)).toThrow(/uPlot/);
  });

  it("builds a chart with a leading x-axis series and one series per spec entry", () => {
    const { Fake, calls } = fakeUplot();
    mountPlot(target, spec, { uPlot: Fake });
    const config = calls.config as { series: unknown[]; width: number };
    // uPlot's series[0] is the x-axis stub; the styled series follow.
    expect(config.series).toHaveLength(2);
    expect(config.width).toBe(600);
  });

  it("rehydrates path-style flags into uPlot path builders", () => {
    const { Fake, calls } = fakeUplot();
    const barSpec: MountSpec = {
      data: [
        [0, 1],
        [2, 3],
      ],
      series: [{ label: "count", stroke: "#1f77b4", paths: "bars" }],
    };
    mountPlot(target, barSpec, { uPlot: Fake });
    const config = calls.config as { series: { paths?: { kind: string }; points?: unknown }[] };
    expect(config.series[1]?.paths?.kind).toBe("bars");
    expect(config.series[1]?.points).toEqual({ show: false });
  });

  it("exposes update, setSize, canvas, and destroy on the handle", () => {
    const { Fake, calls } = fakeUplot();
    const handle = mountPlot(target, spec, { uPlot: Fake });
    handle.update([
      [0, 1],
      [9, 9],
    ]);
    expect(calls.data).toEqual([
      [0, 1],
      [9, 9],
    ]);
    expect(handle.canvas.width).toBe(100);
    handle.destroy();
    expect(calls.destroyed).toBe(true);
  });
});
