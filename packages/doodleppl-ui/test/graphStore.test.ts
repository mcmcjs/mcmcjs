import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

// The store reads and writes localStorage as soon as it is created.
const memory = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
    clear: () => memory.clear(),
    key: (i: number) => [...memory.keys()][i] ?? null,
    get length() {
      return memory.size;
    },
  },
  configurable: true,
});

const { useGraphStore } = await import("../src/widget/stores/graphStore");

describe("graphStore: what an imported document asks for", () => {
  beforeEach(() => {
    memory.clear();
    setActivePinia(createPinia());
  });

  it("a pending layout is taken once, then gone", () => {
    const store = useGraphStore();
    store.createNewGraphContent("g1");
    store.setPendingLayout("g1", "dagre");
    expect(store.graphContents.get("g1")?.pendingLayout).toBe("dagre");
    expect(store.takePendingLayout("g1")).toBe("dagre");
    expect(store.takePendingLayout("g1")).toBeUndefined();
    expect(store.graphContents.get("g1")?.pendingLayout).toBeUndefined();
  });

  it("a graph with nothing pending yields nothing", () => {
    const store = useGraphStore();
    store.createNewGraphContent("g2");
    expect(store.takePendingLayout("g2")).toBeUndefined();
    expect(store.takePendingLayout("missing")).toBeUndefined();
  });

  it("records the language the graph was imported from", () => {
    const store = useGraphStore();
    store.createNewGraphContent("g3");
    expect(store.graphContents.get("g3")?.language).toBeUndefined();
    store.setGraphLanguage("g3", "stan");
    expect(store.graphContents.get("g3")?.language).toBe("stan");
    store.setGraphLanguage("g3", undefined);
    expect(store.graphContents.get("g3")?.language).toBeUndefined();
  });

  it("neither field disturbs the elements or the last layout", () => {
    const store = useGraphStore();
    store.createNewGraphContent("g4");
    store.updateGraphLayout("g4", "preset");
    store.setPendingLayout("g4", "klay");
    store.setGraphLanguage("g4", "bugs");
    const content = store.graphContents.get("g4");
    expect(content?.lastLayout).toBe("preset");
    expect(content?.elements).toEqual([]);
  });
});
