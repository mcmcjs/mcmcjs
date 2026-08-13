/**
 * What a source file says about itself, from text alone. Used to tell a model
 * apart from the rest of a Julia project (a repo full of .jl files is mostly
 * not models) and to explain what a model still needs to be runnable.
 */
export interface ModelSurface {
  kind: "turing" | "juliabugs" | "stan" | "none";
  /** `@model` definitions, in source order. */
  models: { name: string; args: string[] }[];
  /** True when the file defines the entry function a fit calls. */
  hasEntry: boolean;
}

/** The entry function a fit looks for when none is named. */
export const DEFAULT_ENTRY = "build_model";

const MODEL_FUNCTION = /@model\s+function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g;
const MODEL_ASSIGNMENT = /@model\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*=/g;

/** Argument names only: no types, defaults, keyword marker, or splats. */
function parseArgs(list: string): string[] {
  return list
    .replace(/;/g, ",")
    .split(",")
    .map((arg) => arg.trim())
    .filter(Boolean)
    .map((arg) => (arg.split(/[:=]/)[0] ?? "").trim().replace(/\.\.\.$/, ""))
    .filter((arg) => /^[A-Za-z_]\w*$/.test(arg));
}

function definesEntry(source: string, entry: string): boolean {
  const name = entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // `build_model(data) = ...`, `function build_model(data)`, or `const build_model = ...`.
  return new RegExp(`(?:^|\\n)\\s*(?:function\\s+|const\\s+)?${name}\\s*[(=]`).test(source);
}

/**
 * Drops comments and docstrings before looking for definitions. Sampler
 * implementations document themselves with `@model` examples, and a docstring
 * is not a model.
 */
export function stripJuliaProse(source: string): string {
  return source
    .replace(/#=[\s\S]*?=#/g, " ")
    .replace(/"""[\s\S]*?"""/g, " ")
    .replace(/(^|[^\\])#[^\n]*/g, "$1");
}

export function inspectJulia(rawSource: string, entry = DEFAULT_ENTRY): ModelSurface {
  const source = stripJuliaProse(rawSource);
  const models: { name: string; args: string[] }[] = [];
  for (const re of [MODEL_FUNCTION, MODEL_ASSIGNMENT]) {
    re.lastIndex = 0;
    for (const match of source.matchAll(re)) {
      models.push({ name: match[1] as string, args: parseArgs(match[2] ?? "") });
    }
  }
  const bugs = /@bugs\b/.test(source) || /\bJuliaBUGS\b/.test(source);
  const hasEntry = definesEntry(source, entry);
  // A file can carry only the adapter (the model living in an included file),
  // so an entry function alone still makes it a model file.
  const kind = bugs ? "juliabugs" : models.length > 0 || hasEntry ? "turing" : "none";
  return { kind, models, hasEntry };
}

export function inspectStan(source: string): ModelSurface {
  // A Stan program is self-contained: no entry function to look for.
  const isModel = /(^|\n)\s*(model|parameters)\s*\{/.test(source);
  return { kind: isModel ? "stan" : "none", models: [], hasEntry: isModel };
}

export function inspectSource(path: string, source: string, entry = DEFAULT_ENTRY): ModelSurface {
  if (path.toLowerCase().endsWith(".stan")) return inspectStan(source);
  return inspectJulia(source, entry);
}

/**
 * The one line that makes a model file runnable, when we can work it out. A
 * fit calls the entry with the data table, so a model taking named arguments
 * needs an adapter that pulls them out of it.
 */
export function adapterFor(surface: ModelSurface, entry = DEFAULT_ENTRY): string | undefined {
  const model = surface.models[0];
  if (!model || surface.hasEntry) return undefined;
  // A lone argument named `data` is the table itself (the documented idiom);
  // anything else names a column.
  const call =
    model.args.length === 1 && model.args[0] === "data"
      ? `${model.name}(data)`
      : `${model.name}(${model.args.map((arg) => `data.${arg}`).join(", ")})`;
  return `${entry}(data) = ${call}`;
}

/** Explains what a model file is missing, in terms of what to add. */
export function entryAdvice(
  path: string,
  surface: ModelSurface,
  entry = DEFAULT_ENTRY,
): string | undefined {
  if (surface.hasEntry || surface.kind === "stan" || surface.kind === "none") return undefined;
  const adapter = adapterFor(surface, entry);
  const model = surface.models[0];
  if (!adapter || !model) {
    return `${path} defines no ${entry} function for the fit to call; add one that returns the model, or name yours with --entry.`;
  }
  return [
    `${path} defines @model ${model.name} but no ${entry} function for the fit to call.`,
    `Add this line to the file:`,
    `  ${adapter}`,
    `Adjust it if the arguments do not all come from the data.`,
  ].join("\n");
}
