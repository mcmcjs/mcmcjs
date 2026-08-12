import { describe, expect, it } from "vitest";
import {
  boxWidth,
  hintLine,
  listLine,
  renderPicker,
  type Scope,
  tabStrip,
} from "../../src/browse/picker";
import type { Pickable } from "../../src/browse/rows";

function item(label: string, hint = "", search = label): Pickable<string> {
  return { value: label, row: { label, hint, tone: "plain" }, search: search.toLowerCase() };
}

const scopes: Scope<string>[] = [
  {
    label: "Runs",
    items: [item("@1  model.jl", "converged"), item("@2  other.jl", "failed")],
    empty: "no runs yet",
  },
  { label: "Models", items: [item("model.jl", "julia")], empty: "no models" },
];

/** Visible width, ignoring the color escapes picocolors may add. */
function visible(text: string): number {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI is the point
  return text.replace(/\[[0-9;]*m/g, "").length;
}

describe("boxWidth", () => {
  it("stays within the readable range whatever the terminal reports", () => {
    expect(boxWidth(20)).toBe(44);
    expect(boxWidth(undefined)).toBe(78);
    expect(boxWidth(400)).toBe(96);
  });
});

describe("listLine", () => {
  it("puts the label left and the hint right, filling the row exactly", () => {
    const line = listLine({ label: "@1  model.jl", hint: "converged", tone: "plain" }, 40, false);
    expect(line.plain).toHaveLength(38);
    expect(line.plain.trimEnd()).toMatch(/converged$/);
    expect(line.plain.startsWith("  @1  model.jl")).toBe(true);
  });

  it("marks the selected row and keeps the same width", () => {
    const row = { label: "@1  model.jl", hint: "converged", tone: "plain" as const };
    const plain = listLine(row, 40, false).plain;
    const selected = listLine(row, 40, true).plain;
    expect(selected).toHaveLength(plain.length);
    expect(selected.startsWith("  ")).toBe(false);
  });

  it("spends the alignment padding on text before truncating", () => {
    const row = {
      label: "@1   model.jl     NUTS 1000x4",
      hint: "converged",
      tone: "plain" as const,
    };
    const wide = listLine(row, 60, false);
    expect(wide.plain).toContain("@1   model.jl     NUTS 1000x4");

    const narrow = listLine(row, 34, false);
    expect(narrow.plain).toContain("@1 model.jl NUTS");
    expect(narrow.plain).toHaveLength(32);
  });

  it("truncates a long label rather than overflowing the box", () => {
    const line = listLine(
      { label: "a".repeat(200), hint: "b".repeat(200), tone: "plain" },
      40,
      false,
    );
    expect(line.plain).toHaveLength(38);
  });
});

describe("tabStrip", () => {
  it("labels every scope with its count", () => {
    expect(tabStrip(scopes, 0).plain).toBe(" Runs 2   Models 1 ");
  });
});

describe("renderPicker", () => {
  const frame = { scopeIndex: 0, cursor: 0, query: "", columns: 60 };

  it("draws a rectangle: every line is the same visible width", () => {
    const lines = renderPicker(scopes, frame).split("\n");
    const widths = new Set(lines.map(visible));
    expect([...widths]).toEqual([boxWidth(60)]);
  });

  it("shows the active scope's items and the cursor", () => {
    const text = renderPicker(scopes, frame);
    expect(text).toContain("model.jl");
    expect(text).toContain("other.jl");
    expect(text).toContain("left/right scope");
  });

  it("switches contents with the scope index", () => {
    const text = renderPicker(scopes, { ...frame, scopeIndex: 1 });
    expect(text).toContain("julia");
    expect(text).not.toContain("@2");
  });

  it("filters by the typed query and says so when nothing matches", () => {
    expect(renderPicker(scopes, { ...frame, query: "other" })).not.toContain("@1");
    expect(renderPicker(scopes, { ...frame, query: "zzz" })).toContain("no matches");
  });

  it("shows the scope's own empty text before anything is typed", () => {
    const emptyScope: Scope<string>[] = [{ label: "Runs", items: [], empty: "no runs yet" }];
    expect(renderPicker(emptyScope, frame)).toContain("no runs yet");
  });

  it("scrolls to keep the cursor visible and counts what is left", () => {
    const many: Scope<string>[] = [
      {
        label: "Runs",
        items: Array.from({ length: 25 }, (_, i) => item(`@${i + 1}  model.jl`)),
        empty: "none",
      },
    ];
    const top = renderPicker(many, frame);
    expect(top).toContain("@1  model.jl");
    expect(top).toContain("15 more");

    const deep = renderPicker(many, { ...frame, cursor: 24 });
    expect(deep).toContain("@25  model.jl");
    expect(deep).not.toContain("@1  model.jl\n");
  });

  it("stays rectangular at every terminal width", () => {
    for (const columns of [30, 60, 100, 200]) {
      const lines = renderPicker(scopes, { ...frame, columns, cursor: 1 }).split("\n");
      expect(new Set(lines.map(visible)).size).toBe(1);
    }
  });
});

describe("hintLine", () => {
  it("names scope switching only when there is more than one scope", () => {
    expect(hintLine(1)).toBe(" up/down pick · enter open · esc quit ");
    expect(hintLine(2)).toContain("left/right scope");
  });

  it("says what escape does here", () => {
    expect(hintLine(1, "back")).toContain("esc back");
  });
});
