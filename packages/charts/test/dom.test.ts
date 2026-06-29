import type UPlot from "uplot";
import { describe, expect, it } from "vitest";
import { type MountSpec, mountPlot, refLinePlugin } from "../src/dom/index";
import { downsampleAligned, lttb } from "../src/dom/interactions";

// A minimal stand-in for the uPlot constructor: it records what it was built with
// and exposes the surface mountPlot relies on (ctx.canvas, setData, setSize, destroy).
function fakeUplot() {
  const calls = {
    config: undefined as unknown,
    data: undefined as unknown,
    destroyed: false,
    setSeries: [] as [number, unknown][],
  };
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
    setSeries(i: number, o: unknown) {
      calls.setSeries.push([i, o]);
    }
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

  it("maps a series show flag onto the uPlot series config", () => {
    const { Fake, calls } = fakeUplot();
    const s: MountSpec = {
      data: [
        [0, 1],
        [1, 2],
        [3, 4],
      ],
      series: [
        { label: "chain 1", stroke: "#a", show: false },
        { label: "chain 2", stroke: "#b" },
      ],
    };
    mountPlot(target, s, { uPlot: Fake });
    const config = calls.config as { series: { show?: boolean }[] };
    expect(config.series[1]?.show).toBe(false);
    expect(config.series[2]?.show).toBe(true);
  });

  it("setSeriesVisible drives uPlot.setSeries with a 1-based index", () => {
    const { Fake, calls } = fakeUplot();
    const handle = mountPlot(target, spec, { uPlot: Fake });
    handle.setSeriesVisible(0, false);
    expect(calls.setSeries).toEqual([[1, { show: false }]]);
  });

  it("wires no plugins by default but a full interaction set when interactive", () => {
    const bare = fakeUplot();
    mountPlot(target, spec, { uPlot: bare.Fake });
    expect((bare.calls.config as { plugins: unknown[] }).plugins).toHaveLength(0);

    const live = fakeUplot();
    mountPlot(target, spec, { uPlot: live.Fake, interactive: true });
    // tooltip + interaction + modebar
    expect((live.calls.config as { plugins: unknown[] }).plugins.length).toBeGreaterThanOrEqual(3);
  });

  it("adds a reference-line plugin only when refLines are present", () => {
    const { Fake, calls } = fakeUplot();
    mountPlot(target, { ...spec, refLines: [{ value: 1.05 }] }, { uPlot: Fake });
    expect((calls.config as { plugins: unknown[] }).plugins).toHaveLength(1);
  });

  it("renders at a high-DPI pxRatio (>= 2 by default, overridable)", () => {
    const def = fakeUplot();
    mountPlot(target, spec, { uPlot: def.Fake });
    expect((def.calls.config as { pxRatio: number }).pxRatio).toBeGreaterThanOrEqual(2);

    const over = fakeUplot();
    mountPlot(target, spec, { uPlot: over.Fake, pxRatio: 1 });
    expect((over.calls.config as { pxRatio: number }).pxRatio).toBe(1);
  });

  it("downsamples aligned data on mount when a budget is set", () => {
    const { Fake, calls } = fakeUplot();
    const wide: MountSpec = {
      data: [
        Array.from({ length: 100 }, (_, i) => i),
        Array.from({ length: 100 }, (_, i) => i * 2),
      ],
      series: [{ label: "chain 1", stroke: "#a" }],
    };
    mountPlot(target, wide, { uPlot: Fake, downsample: 10 });
    const data = calls.data as number[][];
    expect(data[0]).toHaveLength(10);
    expect(data[0]?.[0]).toBe(0);
    expect(data[0]?.[9]).toBe(99);
  });

  type Axis = { label: string; stroke: string; grid: { stroke: string }; font?: string };
  const axesOf = (calls: { config: unknown }): Axis[] => (calls.config as { axes: Axis[] }).axes;

  it("themes both axes with light colors by default", () => {
    const { Fake, calls } = fakeUplot();
    mountPlot(target, spec, { uPlot: Fake });
    const [x, y] = axesOf(calls);
    expect(x?.label).toBe("iteration");
    expect(x?.stroke).toBe("#1a1a1a");
    expect(x?.grid.stroke).toBe("#e5e7eb");
    expect(y?.stroke).toBe("#1a1a1a");
  });

  it("themes axes with dark colors under the dark preset", () => {
    const { Fake, calls } = fakeUplot();
    mountPlot(target, spec, { uPlot: Fake, theme: "dark" });
    const [x] = axesOf(calls);
    expect(x?.stroke).toBe("#e8eaf0");
    expect(x?.grid.stroke).toBe("#262a3a");
  });

  it("lets axisColor, gridColor, and font override the preset", () => {
    const { Fake, calls } = fakeUplot();
    mountPlot(target, spec, {
      uPlot: Fake,
      theme: "dark",
      axisColor: "rgb(10, 20, 30)",
      gridColor: "rgb(40, 50, 60)",
      font: "12px Inter, sans-serif",
    });
    const [x] = axesOf(calls);
    expect(x?.stroke).toBe("rgb(10, 20, 30)");
    expect(x?.grid.stroke).toBe("rgb(40, 50, 60)");
    expect(x?.font).toBe("12px Inter, sans-serif");
  });
});

describe("refLinePlugin", () => {
  it("strokes a horizontal guide line at each reference value", () => {
    const ops: string[] = [];
    const ctx = {
      save: () => ops.push("save"),
      restore: () => ops.push("restore"),
      beginPath: () => ops.push("begin"),
      moveTo: (x: number, y: number) => ops.push(`move:${x},${y}`),
      lineTo: (x: number, y: number) => ops.push(`line:${x},${y}`),
      stroke: () => ops.push("stroke"),
      setLineDash: () => {},
      lineWidth: 0,
      strokeStyle: "",
    };
    const u = {
      ctx,
      bbox: { left: 10, top: 5, width: 100, height: 80 },
      valToPos: (_v: number, scale: string) => (scale === "y" ? 40 : 60),
    };
    refLinePlugin([{ value: 1 }, { value: 1.05 }]).hooks.draw(u as unknown as never);
    expect(ops.filter((o) => o === "stroke")).toHaveLength(2);
    // Horizontal line spans the plot width at the value's y position.
    expect(ops).toContain("move:10,40.5");
    expect(ops).toContain("line:110,40.5");
  });
});

describe("downsamplers", () => {
  it("downsampleAligned keeps endpoints and shrinks every row uniformly", () => {
    const data = [
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      [0, 10, 20, 30, 40, 50, 60, 70, 80, 90],
    ];
    const out = downsampleAligned(data, 4);
    expect(out[0]).toEqual([0, 3, 6, 9]);
    expect(out[1]).toEqual([0, 30, 60, 90]);
  });

  it("downsampleAligned is a no-op below the budget", () => {
    const data = [
      [0, 1],
      [2, 3],
    ];
    expect(downsampleAligned(data, 10)).toBe(data);
  });

  it("lttb preserves first and last points and hits the target length", () => {
    const xs = Array.from({ length: 50 }, (_, i) => i);
    const ys = xs.map((x) => Math.sin(x));
    const out = lttb(xs, ys, 10);
    expect(out.xs).toHaveLength(10);
    expect(out.xs[0]).toBe(0);
    expect(out.xs[9]).toBe(49);
  });
});
