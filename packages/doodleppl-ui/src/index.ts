/**
 * `doodleppl`: embed the DoodlePPL graphical model editor in any page or app.
 * `new DoodlePPL({ element, ...options })` lazily loads the editor (Vue, Cytoscape,
 * and styles stay out of the consumer's entry chunk), mounts it, and bridges its
 * custom events into typed callbacks. The headless codegen this editor generates
 * through lives in `@mcmcjs/doodleppl`.
 */
import type { GraphElement, UnifiedModelData } from "@mcmcjs/doodleppl";
import { WIDGET_TAG } from "./tag";

export type { GraphEdge, GraphElement, GraphNode, UnifiedModelData } from "@mcmcjs/doodleppl";
export { type ExampleModelConfig, examples as exampleModels } from "./widget/config/examples";

/** One graph's canvas content inside the editor state. */
export interface DoodlePPLGraphContent {
  graphId: string;
  elements: GraphElement[];
  lastLayout?: string;
  zoom?: number;
  pan?: { x: number; y: number };
}

/** The editor's full state, as emitted by `onReady`/`onStateChange`. */
export interface DoodlePPLState {
  project: unknown;
  graphs: DoodlePPLGraphContent[];
  /** Per-graph data/inits blob; `content` is a JSON string `{ "data": ..., "inits": ... }`. */
  data: { graphId: string; content: string }[];
  currentGraphId: string | null;
}

export interface DoodlePPLOptions {
  /** Mount point: a CSS selector (matched against the document) or the element itself.
   * Pass the element when the mount point lives inside a shadow root. */
  element: string | HTMLElement;
  /** Initial editor state: a prior `onStateChange`/`onReady` payload, object or JSON string. */
  state?: DoodlePPLState | string;
  /** Bundled example model to open (e.g. `"rats"`). */
  example?: string;
  /**
   * `"embedded"` (default) keeps the maximize and edit toggles for hosts that mount
   * the editor as one feature; `"fullpage"` pins it maximized with editing always on.
   */
  mode?: "embedded" | "fullpage";
  theme?: "light" | "dark";
  /** localStorage key for the editor's persistence; omit for the editor default. */
  storageKey?: string;
  /** CSS size of the editor (defaults: 100% x 600px). */
  width?: string;
  height?: string;
  /** Extra attributes passed through to the underlying element. */
  attributes?: Record<string, string>;
  /** Fires once the editor is interactive, with its initial state. */
  onReady?: (state: DoodlePPLState) => void;
  /** Fires (debounced by the editor) whenever the project, graphs, or data change. */
  onStateChange?: (state: DoodlePPLState) => void;
  /** Fires with regenerated BUGS model code. */
  onBugsCode?: (code: string) => void;
  /** Fires with regenerated Stan model code. */
  onStanCode?: (code: string) => void;
}

function resolveHost(element: string | HTMLElement): HTMLElement {
  const host = element instanceof HTMLElement ? element : document.querySelector(element);
  if (!(host instanceof HTMLElement)) {
    throw new Error(`DoodlePPL: no element matches ${JSON.stringify(String(element))}`);
  }
  return host;
}

/** Register the editor element on first use; a no-op when the page already defines it. */
async function loadWidget(): Promise<void> {
  if (!customElements.get(WIDGET_TAG)) {
    await import("./element");
  }
  await customElements.whenDefined(WIDGET_TAG);
}

/** The custom element wraps Vue emit args as `detail: [payload]`; unwrap to the payload. */
function unwrapDetail(event: Event): unknown {
  const detail = (event as CustomEvent).detail;
  return Array.isArray(detail) ? detail[0] : detail;
}

function parseState(payload: unknown): DoodlePPLState | null {
  const value = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (value && typeof value === "object" && Array.isArray((value as DoodlePPLState).graphs)) {
    return value as DoodlePPLState;
  }
  return null;
}

/** Mounts the DoodlePPL editor into a host element and bridges it to typed callbacks. */
export class DoodlePPL {
  /** Resolves once the editor is interactive (after its `ready` event). */
  readonly ready: Promise<void>;

  private host: HTMLElement;
  private opts: DoodlePPLOptions;
  private el: HTMLElement | null = null;
  private lastState: DoodlePPLState | null = null;
  private listeners: [string, EventListener][] = [];
  private destroyed = false;

  constructor(options: DoodlePPLOptions) {
    this.opts = options;
    this.host = resolveHost(options.element);
    let markReady = (): void => undefined;
    this.ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    void loadWidget().then(() => {
      if (this.destroyed) return;
      this.mount(markReady);
    });
  }

  private mount(markReady: () => void): void {
    const { opts } = this;
    const el = document.createElement(WIDGET_TAG);
    el.style.display = "block";

    const state = opts.state;
    if (state !== undefined) {
      el.setAttribute("initial-state", typeof state === "string" ? state : JSON.stringify(state));
    }
    if (opts.example) el.setAttribute("model", opts.example);
    if (opts.mode) el.setAttribute("mode", opts.mode);
    if (opts.theme) el.setAttribute("theme-mode", opts.theme);
    if (opts.storageKey) el.setAttribute("storage-key", opts.storageKey);
    if (opts.width) el.setAttribute("width", opts.width);
    if (opts.height) el.setAttribute("height", opts.height);
    for (const [name, value] of Object.entries(opts.attributes ?? {})) {
      el.setAttribute(name, value);
    }

    const on = (type: string, handler: (payload: unknown) => void): void => {
      const listener: EventListener = (event) => handler(unwrapDetail(event));
      el.addEventListener(type, listener);
      this.listeners.push([type, listener]);
    };

    on("ready", (payload) => {
      this.lastState = parseState(payload) ?? this.lastState;
      markReady();
      if (this.lastState) this.opts.onReady?.(this.lastState);
    });
    on("state-update", (payload) => {
      const next = parseState(payload);
      if (!next) return;
      this.lastState = next;
      this.opts.onStateChange?.(next);
    });
    on("bugs-code-update", (payload) => this.opts.onBugsCode?.(String(payload)));
    on("stan-code-update", (payload) => this.opts.onStanCode?.(String(payload)));

    this.host.appendChild(el);
    this.el = el;
  }

  /** The last state the editor reported, or null before `ready`. */
  getState(): DoodlePPLState | null {
    return this.lastState;
  }

  /** The current graph as a portable model document (the shape `@mcmcjs/doodleppl` parses). */
  getGraph(): UnifiedModelData | null {
    const state = this.lastState;
    if (!state?.currentGraphId) return null;
    const graph = state.graphs.find((g) => g.graphId === state.currentGraphId);
    if (!graph) return null;
    const data = state.data.find((d) => d.graphId === state.currentGraphId);
    return {
      name: state.currentGraphId,
      elements: graph.elements,
      ...(data?.content ? { dataContent: data.content } : {}),
      version: 1,
    };
  }

  setTheme(theme: "light" | "dark"): void {
    this.el?.setAttribute("theme-mode", theme);
  }

  /** Remove the editor and release its listeners. */
  destroy(): void {
    this.destroyed = true;
    if (this.el) {
      for (const [type, listener] of this.listeners) {
        this.el.removeEventListener(type, listener);
      }
      this.el.remove();
    }
    this.listeners = [];
    this.el = null;
  }
}
