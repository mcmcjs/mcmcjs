import { Prompt } from "@clack/core";
import { unicodeOr } from "@clack/prompts";
import pc from "picocolors";
import { filterPickables, type Pickable, type Row, type Tone } from "./rows";

export interface Scope<T> {
  label: string;
  items: Pickable<T>[];
  /** Shown in place of the list when the scope is empty. */
  empty: string;
}

const GLYPH = {
  topLeft: unicodeOr("┌", "+"),
  topRight: unicodeOr("┐", "+"),
  bottomLeft: unicodeOr("└", "+"),
  bottomRight: unicodeOr("┘", "+"),
  vertical: unicodeOr("│", "|"),
  horizontal: unicodeOr("─", "-"),
  teeLeft: unicodeOr("├", "+"),
  teeRight: unicodeOr("┤", "+"),
  cursor: unicodeOr("❯", ">"),
  input: unicodeOr("▸", ">"),
};

const ROWS = 10;
const MIN_WIDTH = 44;
const MAX_WIDTH = 96;

const TONES: Record<Tone, (text: string) => string> = {
  good: pc.green,
  bad: pc.red,
  warn: pc.yellow,
  plain: pc.dim,
};

export function boxWidth(columns: number | undefined): number {
  return Math.max(MIN_WIDTH, Math.min((columns || 80) - 2, MAX_WIDTH));
}

function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  return text.length > width
    ? `${text.slice(0, Math.max(0, width - 1))}${unicodeOr("…", "~")}`
    : text;
}

/**
 * One list line: the label on the left, the hint right-aligned, both trimmed to
 * fit. Returned as plain text plus the pieces to color, so the caller pads on
 * visible width rather than on escape codes.
 */
export function listLine(
  row: Row,
  inner: number,
  selected: boolean,
): { plain: string; text: string } {
  const marker = selected ? `${GLYPH.cursor} ` : "  ";
  // Two columns go to the margins `bar` keeps inside the borders.
  const room = inner - 2 - marker.length;
  const hint = truncate(row.hint, Math.max(0, Math.floor(room / 2)));
  const budget = Math.max(1, room - hint.length - 2);
  // Column padding is what makes rows line up, but on a narrow terminal the
  // text matters more, so spend those columns on content before truncating.
  const label = truncate(
    row.label.length > budget ? row.label.replace(/\s{2,}/g, " ") : row.label,
    budget,
  );
  const gap = " ".repeat(Math.max(1, room - label.length - hint.length));
  const plain = `${marker}${label}${gap}${hint}`;
  const tone = TONES[row.tone];
  const text = `${selected ? pc.cyan(marker) : marker}${selected ? pc.bold(label) : label}${gap}${tone(hint)}`;
  return { plain, text };
}

/** The tab strip: the active scope inverted, each labelled with its count. */
export function tabStrip(
  scopes: readonly { label: string; items: readonly unknown[] }[],
  active: number,
): { plain: string; text: string } {
  const parts = scopes.map((scope) => ` ${scope.label} ${scope.items.length} `);
  return {
    plain: parts.join(" "),
    text: parts
      .map((part, i) => (i === active ? pc.inverse(pc.bold(part)) : pc.dim(part)))
      .join(" "),
  };
}

export interface PickerFrame {
  scopeIndex: number;
  cursor: number;
  query: string;
  columns?: number;
  /** What escape does here: "quit" at the top level, "back" inside. */
  escape?: string;
}

/** The footer keys, naming only the ones this box actually has. */
export function hintLine(scopeCount: number, escapeDoes = "quit"): string {
  const parts = scopeCount > 1 ? ["left/right scope"] : [];
  parts.push("up/down pick", "enter open", `esc ${escapeDoes}`);
  return ` ${parts.join(" · ")} `;
}

/** Renders the whole box. Pure, so the layout is testable without a terminal. */
export function renderPicker<T>(scopes: readonly Scope<T>[], frame: PickerFrame): string {
  const width = boxWidth(frame.columns);
  const inner = width - 2;
  const scope = scopes[frame.scopeIndex];
  const visible = scope ? filterPickables(scope.items, frame.query) : [];
  const cursor = Math.min(Math.max(0, frame.cursor), Math.max(0, visible.length - 1));

  const bar = (content: string, plainLength: number) =>
    `${pc.dim(GLYPH.vertical)} ${content}${" ".repeat(Math.max(0, inner - 2 - plainLength))} ${pc.dim(GLYPH.vertical)}`;

  const tabs = tabStrip(scopes, frame.scopeIndex);
  const top = `${pc.dim(GLYPH.topLeft + GLYPH.horizontal)} ${tabs.text} ${pc.dim(
    GLYPH.horizontal.repeat(Math.max(0, inner - tabs.plain.length - 3)) + GLYPH.topRight,
  )}`;

  const input = `${pc.cyan(GLYPH.input)} ${frame.query}${pc.inverse(" ")}`;
  const lines = [
    top,
    bar(input, 2 + frame.query.length + 1),
    pc.dim(`${GLYPH.teeLeft}${GLYPH.horizontal.repeat(inner)}${GLYPH.teeRight}`),
  ];

  const offset = Math.max(0, cursor - ROWS + 1);
  const page = visible.slice(offset, offset + ROWS);
  if (page.length === 0) {
    const empty = frame.query ? "no matches" : (scope?.empty ?? "nothing here");
    lines.push(bar(pc.dim(empty), empty.length));
  }
  for (const [i, item] of page.entries()) {
    const line = listLine(item.row, inner, offset + i === cursor);
    lines.push(bar(line.text, line.plain.length));
  }
  const more = visible.length - offset - page.length;
  if (more > 0) {
    const text = `${unicodeOr("…", "...")} ${more} more`;
    lines.push(bar(pc.dim(text), text.length));
  }

  const hints = truncate(hintLine(scopes.length, frame.escape), inner);
  lines.push(
    pc.dim(
      `${GLYPH.bottomLeft}${hints}${GLYPH.horizontal.repeat(Math.max(0, inner - hints.length))}${GLYPH.bottomRight}`,
    ),
  );
  return lines.join("\n");
}

/**
 * The search box: type to filter, left/right to switch scope, up/down to move,
 * enter to pick. Resolves undefined when dismissed.
 */
export function pick<T>(
  scopes: readonly Scope<T>[],
  opts: { escape?: string } = {},
): Promise<T | undefined> {
  let scopeIndex = 0;
  let cursor = 0;
  let visible: Pickable<T>[] = scopes[0]?.items ?? [];

  const prompt = new Prompt<T>(
    {
      render() {
        const scope = scopes[scopeIndex];
        visible = scope ? filterPickables(scope.items, this.userInput) : [];
        if (cursor >= visible.length) cursor = Math.max(0, visible.length - 1);
        if (this.state === "submit" || this.state === "cancel") return "";
        return renderPicker(scopes, {
          scopeIndex,
          cursor,
          query: this.userInput,
          columns: process.stdout.columns,
          escape: opts.escape,
        });
      },
    },
    true,
  );

  prompt.on("cursor", (action) => {
    if (action === "left") {
      scopeIndex = (scopeIndex + scopes.length - 1) % scopes.length;
      cursor = 0;
    } else if (action === "right") {
      scopeIndex = (scopeIndex + 1) % scopes.length;
      cursor = 0;
    } else if (action === "up") {
      cursor = Math.max(0, cursor - 1);
    } else if (action === "down") {
      cursor = Math.min(Math.max(0, visible.length - 1), cursor + 1);
    }
  });
  prompt.on("finalize", () => {
    prompt.value = prompt.state === "submit" ? visible[cursor]?.value : undefined;
  });

  return prompt
    .prompt()
    .then((value) => (typeof value === "symbol" ? undefined : (value as T | undefined)));
}
