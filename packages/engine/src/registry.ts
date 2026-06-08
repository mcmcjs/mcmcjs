import type { Engine } from "./engine";

export interface EngineRegistry {
  register(engine: Engine): void;
  get(id: string): Engine;
  ids(): string[];
  /** Resolves the requested engine, falling back to the default when none is given. */
  resolve(id?: string): Engine;
}

export function createRegistry(defaultId: string): EngineRegistry {
  const engines = new Map<string, Engine>();
  const get = (id: string): Engine => {
    const engine = engines.get(id);
    if (!engine) throw new Error(`unknown engine: ${id}`);
    return engine;
  };
  return {
    register: (engine) => void engines.set(engine.id, engine),
    get,
    ids: () => [...engines.keys()],
    resolve: (id) => get(id ?? defaultId),
  };
}
