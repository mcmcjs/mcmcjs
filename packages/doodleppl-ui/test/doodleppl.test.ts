// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DoodlePPL, type DoodlePPLState } from "../src/index";
import { WIDGET_TAG } from "../src/tag";

// A stub editor element: predefining the tag short-circuits the lazy widget import,
// so these tests exercise the mount-class contract without loading Vue.
beforeAll(() => {
  if (!customElements.get(WIDGET_TAG)) {
    customElements.define(WIDGET_TAG, class extends HTMLElement {});
  }
});

const STATE: DoodlePPLState = {
  project: { name: "p" },
  graphs: [
    {
      graphId: "g1",
      elements: [
        { id: "n1", name: "mu", type: "node", nodeType: "stochastic", distribution: "dnorm" },
      ],
    },
  ],
  data: [{ graphId: "g1", content: '{"data":{"y":[1]},"inits":{}}' }],
  currentGraphId: "g1",
};

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  host.id = "mount";
  document.body.appendChild(host);
});

async function mounted(options: ConstructorParameters<typeof DoodlePPL>[0]) {
  const editor = new DoodlePPL(options);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const el = host.querySelector(WIDGET_TAG) as HTMLElement;
  expect(el).not.toBeNull();
  return { editor, el };
}

describe("DoodlePPL", () => {
  it("throws when the mount element does not exist", () => {
    expect(() => new DoodlePPL({ element: "#nope" })).toThrow(/no element matches/);
  });

  it("mounts the element with the options mapped to attributes", async () => {
    const { el } = await mounted({
      element: "#mount",
      state: STATE,
      example: "rats",
      theme: "dark",
      storageKey: "k1",
      width: "800px",
      height: "500px",
      attributes: { "controls-position": "top-left" },
    });
    expect(JSON.parse(el.getAttribute("initial-state") ?? "")).toEqual(STATE);
    expect(el.getAttribute("model")).toBe("rats");
    expect(el.getAttribute("theme-mode")).toBe("dark");
    expect(el.getAttribute("storage-key")).toBe("k1");
    expect(el.getAttribute("width")).toBe("800px");
    expect(el.getAttribute("height")).toBe("500px");
    expect(el.getAttribute("controls-position")).toBe("top-left");
  });

  it("resolves ready and fires onReady with the parsed state", async () => {
    const onReady = vi.fn();
    const { editor, el } = await mounted({ element: host, onReady });
    // Vue custom elements wrap emit args as detail: [payload].
    el.dispatchEvent(new CustomEvent("ready", { detail: [JSON.stringify(STATE)] }));
    await editor.ready;
    expect(onReady).toHaveBeenCalledWith(STATE);
    expect(editor.getState()).toEqual(STATE);
  });

  it("normalizes state-update payloads: array-wrapped JSON and bare objects", async () => {
    const onStateChange = vi.fn();
    const { editor, el } = await mounted({ element: host, onStateChange });
    el.dispatchEvent(new CustomEvent("state-update", { detail: [JSON.stringify(STATE)] }));
    expect(onStateChange).toHaveBeenLastCalledWith(STATE);
    const next = { ...STATE, currentGraphId: "g2" };
    el.dispatchEvent(new CustomEvent("state-update", { detail: next }));
    expect(onStateChange).toHaveBeenLastCalledWith(next);
    expect(editor.getState()).toEqual(next);
  });

  it("passes generated code to the callbacks as strings", async () => {
    const onBugsCode = vi.fn();
    const onStanCode = vi.fn();
    const { el } = await mounted({ element: host, onBugsCode, onStanCode });
    el.dispatchEvent(new CustomEvent("bugs-code-update", { detail: ["model {\n}"] }));
    el.dispatchEvent(new CustomEvent("stan-code-update", { detail: "data {\n}" }));
    expect(onBugsCode).toHaveBeenCalledWith("model {\n}");
    expect(onStanCode).toHaveBeenCalledWith("data {\n}");
  });

  it("getGraph returns the current graph as a portable model document", async () => {
    const { editor, el } = await mounted({ element: host });
    expect(editor.getGraph()).toBeNull();
    el.dispatchEvent(new CustomEvent("state-update", { detail: [JSON.stringify(STATE)] }));
    expect(editor.getGraph()).toEqual({
      name: "g1",
      elements: STATE.graphs[0].elements,
      dataContent: '{"data":{"y":[1]},"inits":{}}',
      version: 1,
    });
  });

  it("setTheme updates the element and destroy removes it and stops callbacks", async () => {
    const onStateChange = vi.fn();
    const { editor, el } = await mounted({ element: host, onStateChange });
    editor.setTheme("light");
    expect(el.getAttribute("theme-mode")).toBe("light");
    editor.destroy();
    expect(host.querySelector(WIDGET_TAG)).toBeNull();
    el.dispatchEvent(new CustomEvent("state-update", { detail: [JSON.stringify(STATE)] }));
    expect(onStateChange).not.toHaveBeenCalled();
  });
});
