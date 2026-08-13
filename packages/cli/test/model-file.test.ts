import { describe, expect, it } from "vitest";
import {
  adapterFor,
  entryAdvice,
  inspectJulia,
  inspectSource,
  inspectStan,
} from "../src/model-file";

describe("inspectJulia", () => {
  it("finds a model defined with @model function", () => {
    const surface = inspectJulia(`using Turing

@model function eight_schools(J, y, sigma)
    mu ~ Normal(0, 5)
end
`);
    expect(surface.kind).toBe("turing");
    expect(surface.models).toEqual([{ name: "eight_schools", args: ["J", "y", "sigma"] }]);
    expect(surface.hasEntry).toBe(false);
  });

  it("finds the assignment form too", () => {
    const surface = inspectJulia("@model coin(n, k) = begin end");
    expect(surface.models).toEqual([{ name: "coin", args: ["n", "k"] }]);
  });

  it("strips types, defaults, and keyword arguments from the signature", () => {
    const surface = inspectJulia(
      "@model function m(y::Vector{Float64}, n::Int = 3; prior = 1)\nend",
    );
    expect(surface.models[0]?.args).toEqual(["y", "n", "prior"]);
  });

  it("sees the entry function in each form it can be written", () => {
    for (const source of [
      "build_model(data) = m(data.y)",
      "function build_model(data)\n  return m(data.y)\nend",
      "const build_model = data -> m(data.y)",
    ]) {
      expect(inspectJulia(source).hasEntry, source).toBe(true);
    }
  });

  it("does not mistake a mention for a definition", () => {
    expect(inspectJulia("# call build_model later\nx = 1").hasEntry).toBe(false);
    expect(inspectJulia("run_build_model(data) = 1").hasEntry).toBe(false);
  });

  it("honors a custom entry name", () => {
    expect(inspectJulia("make_model(data) = m(data.y)", "make_model").hasEntry).toBe(true);
    expect(inspectJulia("make_model(data) = m(data.y)").hasEntry).toBe(false);
  });

  it("recognises JuliaBUGS", () => {
    expect(inspectJulia("using JuliaBUGS\n@bugs begin end").kind).toBe("juliabugs");
  });

  // Turing's own sampler files document themselves with @model examples.
  it("does not count a model in a docstring or a comment", () => {
    const sampler = `"""
    ESS()

# Examples
\`\`\`julia
@model function demo(x)
    m ~ Normal()
end
\`\`\`
"""
struct ESS end
`;
    expect(inspectJulia(sampler).kind).toBe("none");
    expect(inspectJulia("# @model function m(y) end").kind).toBe("none");
    expect(inspectJulia("#=\n@model function m(y) end\n=#").kind).toBe("none");
  });

  // The reason this exists: a Julia repo is mostly not models.
  it("reads ordinary Julia source as no model at all", () => {
    const sampler = `module Inference
using AbstractMCMC
struct Emcee end
function AbstractMCMC.step(rng, model, ::Emcee)
    return nothing
end
end
`;
    expect(inspectJulia(sampler).kind).toBe("none");
    expect(inspectJulia("using Turing\n# notes about @model syntax").kind).toBe("none");
  });
});

describe("inspectStan", () => {
  it("accepts a program with a model or parameters block", () => {
    expect(
      inspectStan("data { int N; }\nparameters { real mu; }\nmodel { mu ~ normal(0,1); }").kind,
    ).toBe("stan");
    expect(inspectStan("parameters {\n real mu;\n}").kind).toBe("stan");
  });

  it("rejects a functions-only include", () => {
    expect(inspectStan("functions {\n  real f(real x) { return x; }\n}").kind).toBe("none");
  });

  it("needs no entry function", () => {
    expect(inspectStan("model { }").hasEntry).toBe(true);
  });
});

describe("inspectSource", () => {
  it("picks the reader from the extension", () => {
    expect(inspectSource("/p/m.stan", "model { }").kind).toBe("stan");
    expect(inspectSource("/p/m.jl", "@model function m(y) end").kind).toBe("turing");
  });
});

describe("adapterFor", () => {
  it("maps each argument to a data field", () => {
    const surface = inspectJulia("@model function m(J, y, sigma)\nend");
    expect(adapterFor(surface)).toBe("build_model(data) = m(data.J, data.y, data.sigma)");
  });

  it("passes the table straight through only when the argument is the table", () => {
    expect(adapterFor(inspectJulia("@model function m(data)\nend"))).toBe(
      "build_model(data) = m(data)",
    );
    // One argument named for a column is still a column.
    expect(adapterFor(inspectJulia("@model function m(y)\nend"))).toBe(
      "build_model(data) = m(data.y)",
    );
  });

  it("has nothing to add when the entry already exists", () => {
    expect(
      adapterFor(inspectJulia("@model function m(y) end\nbuild_model(data) = m(data.y)")),
    ).toBeUndefined();
  });
});

describe("entryAdvice", () => {
  it("names the model and the line to add", () => {
    const advice = entryAdvice("model.jl", inspectJulia("@model function m(y)\nend"));
    expect(advice).toContain("model.jl defines @model m but no build_model");
    expect(advice).toContain("build_model(data) = m(data.y)");
  });

  it("stays quiet for a file that is already runnable, or not a model", () => {
    expect(entryAdvice("m.jl", inspectJulia("build_model(data) = 1"))).toBeUndefined();
    expect(entryAdvice("m.stan", inspectStan("model { }"))).toBeUndefined();
    expect(entryAdvice("x.jl", inspectJulia("x = 1"))).toBeUndefined();
  });
});
