import { describe, expect, it } from "vitest";
import type { Engine } from "../src/engine";
import { createRegistry } from "../src/registry";

const fakeEngine = (id: string): Engine => ({
  id,
  displayName: id,
  capabilities: { setup: true, versions: true, fit: false, predict: false },
  doctor: async () => ({ engineId: id, ready: true, tools: [] }),
});

describe("createRegistry", () => {
  it("registers and gets engines by id", () => {
    const registry = createRegistry("julia");
    registry.register(fakeEngine("julia"));
    expect(registry.get("julia").id).toBe("julia");
    expect(registry.ids()).toEqual(["julia"]);
  });

  it("resolves the default engine when none is requested", () => {
    const registry = createRegistry("julia");
    registry.register(fakeEngine("julia"));
    registry.register(fakeEngine("stan"));
    expect(registry.resolve().id).toBe("julia");
    expect(registry.resolve("stan").id).toBe("stan");
  });

  it("throws for an unknown engine", () => {
    const registry = createRegistry("julia");
    expect(() => registry.get("nope")).toThrow(/unknown engine/);
  });
});
