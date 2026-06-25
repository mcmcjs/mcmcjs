import { describe, expect, it } from "vitest";
import { parseArvizJson } from "../../src/parsers/arviz";
import { chainView } from "../../src/types";

describe("parseArvizJson", () => {
  it("parses scalar variables", () => {
    const s = parseArvizJson({
      posterior: {
        data_vars: {
          mu: {
            dims: ["chain", "draw"],
            data: [
              [1, 2, 3],
              [1.1, 2.1, 3.1],
            ],
          },
          sigma: {
            dims: ["chain", "draw"],
            data: [
              [0.5, 0.6, 0.7],
              [0.4, 0.5, 0.6],
            ],
          },
        },
      },
    });
    expect(s.nChains).toBe(2);
    expect(s.nDraws).toBe(3);
    expect(s.variables).toEqual(["mu", "sigma"]);
    expect([...chainView(s, "mu", 1)]).toEqual([1.1, 2.1, 3.1]);
    expect([...chainView(s, "sigma", 0)]).toEqual([0.5, 0.6, 0.7]);
  });

  it("flattens multidimensional variables into name[i] keys", () => {
    const s = parseArvizJson({
      posterior: {
        data_vars: {
          theta: {
            dims: ["chain", "draw", "d"],
            data: [
              [
                [1, 2],
                [3, 4],
                [5, 6],
              ],
              [
                [7, 8],
                [9, 10],
                [11, 12],
              ],
            ],
          },
        },
      },
    });
    expect(s.variables).toEqual(["theta[0]", "theta[1]"]);
    expect([...chainView(s, "theta[0]", 0)]).toEqual([1, 3, 5]);
    expect([...chainView(s, "theta[1]", 0)]).toEqual([2, 4, 6]);
    expect([...chainView(s, "theta[0]", 1)]).toEqual([7, 9, 11]);
  });

  it("reads the sample_stats group into sampleStats", () => {
    const s = parseArvizJson({
      posterior: {
        data_vars: {
          mu: {
            dims: ["chain", "draw"],
            data: [
              [1, 2],
              [3, 4],
            ],
          },
        },
      },
      sample_stats: {
        data_vars: {
          diverging: {
            dims: ["chain", "draw"],
            data: [
              [0, 1],
              [0, 0],
            ],
          },
        },
      },
    });
    expect(s.sampleStats.has("diverging")).toBe(true);
    expect([...(s.sampleStats.get("diverging") ?? [])]).toEqual([0, 1, 0, 0]);
  });

  it("throws when posterior is missing", () => {
    expect(() => parseArvizJson({})).toThrow(/posterior/);
  });

  it("flattens an N-dimensional variable in C-order", () => {
    const s = parseArvizJson({
      posterior: {
        data_vars: {
          theta: {
            dims: ["chain", "draw", "dim0", "dim1"],
            data: [
              [
                [
                  [1, 2],
                  [3, 4],
                ],
                [
                  [5, 6],
                  [7, 8],
                ],
              ],
              [
                [
                  [10, 20],
                  [30, 40],
                ],
                [
                  [50, 60],
                  [70, 80],
                ],
              ],
            ],
          },
        },
      },
    });
    expect(s.variables).toEqual(["theta[0,0]", "theta[0,1]", "theta[1,0]", "theta[1,1]"]);
    expect(s.nChains).toBe(2);
    expect(s.nDraws).toBe(2);
    expect(Array.from(s.draws.get("theta[0,0]") as Float64Array)).toEqual([1, 5, 10, 50]);
    expect(Array.from(s.draws.get("theta[1,1]") as Float64Array)).toEqual([4, 8, 40, 80]);
  });

  it("honors a transposed draw,chain dim order", () => {
    const s = parseArvizJson({
      posterior: {
        data_vars: {
          mu: {
            dims: ["draw", "chain"],
            data: [
              [1, 2],
              [3, 4],
              [5, 6],
            ],
          },
        },
      },
    });
    expect(s.nChains).toBe(2);
    expect(s.nDraws).toBe(3);
    expect(Array.from(chainView(s, "mu", 0))).toEqual([1, 3, 5]);
    expect(Array.from(chainView(s, "mu", 1))).toEqual([2, 4, 6]);
  });
});
