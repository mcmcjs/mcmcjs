import type { CommandRunner, ToolInfo } from "./runner";

export interface EngineContext {
  run: CommandRunner;
  platform: NodeJS.Platform;
}

export interface EngineCapabilities {
  setup: boolean;
  versions: boolean;
  fit: boolean;
  predict: boolean;
}

export interface NamedToolInfo extends ToolInfo {
  name: string;
}

export interface HealthReport {
  engineId: string;
  ready: boolean;
  tools: NamedToolInfo[];
  /** Guidance shown when the engine is not ready. */
  hint?: string;
}

export interface RuntimeVersion {
  /** Channel or version identifier, e.g. "release" or "1.10". */
  id: string;
  version?: string;
  path?: string;
  isDefault: boolean;
}

/** A runtime or PPL backend. Julia is the first; others implement the same contract. */
export interface Engine {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: EngineCapabilities;
  doctor(ctx: EngineContext): Promise<HealthReport>;
}
