// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { type MountSpec, mountPlot } from "../src/dom/index";

function fakeUplot() {
  const calls = { config: undefined as unknown };
  class Fake {
    ctx = { canvas: { width: 100, height: 50 } };
    constructor(config: unknown, _data: unknown, _target: unknown) {
      calls.config = config;
    }
    setData() {}
    setSize() {}
    destroy() {}
  }
  return { Fake: Fake as never, calls };
}

const spec: MountSpec = {
  title: "mu",
  xLabel: "iteration",
  data: [
    [0, 1, 2],
    [1, 2, 3],
  ],
  series: [{ label: "chain 1", stroke: "#1f77b4" }],
};

describe("modebarButtons", () => {
  it("appends the extra buttons to the modebar and wires their click handlers", () => {
    const { Fake, calls } = fakeUplot();
    let clicked = 0;
    mountPlot({ clientWidth: 600 } as unknown as HTMLElement, spec, {
      uPlot: Fake,
      interactive: true,
      modebarButtons: [{ icon: "<svg></svg>", title: "Expand", onClick: () => clicked++ }],
    });
    const plugins = (calls.config as { plugins: { hooks?: { ready?: (u: unknown) => void } }[] })
      .plugins;
    const over = document.createElement("div");
    document.body.appendChild(over);
    for (const plugin of plugins) plugin.hooks?.ready?.({ over, root: over });
    const btn = over.querySelector<HTMLButtonElement>('button[title="Expand"]');
    expect(btn).not.toBeNull();
    btn?.click();
    expect(clicked).toBe(1);
    over.remove();
  });
});
