import { describe, expect, it } from "vitest";
import { labelTex, labelText, nodeLabel } from "../../src/figure/label";

const tex = (name: string, indices?: string) => labelTex(nodeLabel(name, indices));
const text = (name: string, indices?: string) => labelText(nodeLabel(name, indices));

describe("nodeLabel", () => {
  it("sets a Greek name as its letter", () => {
    expect(tex("mu")).toBe("\\mu");
    expect(text("mu")).toEqual({ base: "μ", subscript: "" });
    expect(tex("Sigma")).toBe("\\Sigma");
  });

  it("turns indices into a subscript", () => {
    expect(tex("b", "i")).toBe("b_{i}");
    expect(tex("mu", "i, j")).toBe("\\mu_{i,j}");
    expect(text("mu", "i,j")).toEqual({ base: "μ", subscript: "i,j" });
  });

  it("turns a dotted suffix into a subscript before the indices", () => {
    expect(tex("alpha.c")).toBe("\\alpha_{c}");
    expect(tex("tau.b", "k")).toBe("\\tau_{b,k}");
    expect(text("alpha.tau")).toEqual({ base: "α", subscript: "τ" });
  });

  it("subscripts a trailing number only after a letter or a Greek name", () => {
    expect(tex("beta0")).toBe("\\beta_{0}");
    expect(tex("x2")).toBe("x_{2}");
    expect(tex("log10")).toBe("\\mathit{log10}");
  });

  it("keeps a multi-letter word together and escapes TeX characters", () => {
    expect(tex("xbar")).toBe("\\mathit{xbar}");
    expect(tex("n_obs")).toBe("n\\_obs");
  });
});
