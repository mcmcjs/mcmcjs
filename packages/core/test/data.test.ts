import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadDataFile,
  missingDataRefusal,
  missingVariables,
  resolveData,
  validateCanonicalData,
} from "../src/data";

const write = (name: string, text: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "mcmcjs-data-"));
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
};

describe("validateCanonicalData", () => {
  it("accepts scalars and rectangular nested numeric arrays", () => {
    const data = {
      N: 10,
      y: [0.2, -1.1],
      x: [
        [1, 2],
        [3, 4],
      ],
    };
    expect(validateCanonicalData(data)).toBe(data);
  });

  it("rejects non-finite and non-numeric values, naming the path", () => {
    expect(() => validateCanonicalData({ y: [1, Number.NaN] })).toThrow(/y\[1\].*finite/);
    expect(() => validateCanonicalData({ a: Number.POSITIVE_INFINITY })).toThrow(/a.*finite/);
    expect(() => validateCanonicalData({ s: "x" })).toThrow(/s.*numbers or nested numeric arrays/);
    expect(() => validateCanonicalData({ y: [1, undefined, 3] })).toThrow(/y\[1\].*undefined/);
  });

  it("keeps a null as an unobserved entry, at any depth", () => {
    expect(validateCanonicalData({ y: [1, null, 3] })).toEqual({ y: [1, null, 3] });
    expect(
      validateCanonicalData({
        t: [
          [1, null],
          [null, null],
        ],
        a: null,
      }),
    ).toEqual({
      t: [
        [1, null],
        [null, null],
      ],
      a: null,
    });
  });

  it("rejects ragged arrays, naming the offending element", () => {
    expect(() => validateCanonicalData({ x: [[1, 2], [3]] })).toThrow(/x.*ragged: element 1/);
  });
});

describe("loadDataFile", () => {
  it("loads a JSON object verbatim", () => {
    const path = write("d.json", JSON.stringify({ J: 8, y: [28, 8], sigma: [15, 10] }));
    expect(loadDataFile(path)).toEqual({ J: 8, y: [28, 8], sigma: [15, 10] });
  });

  it("rejects JSON that is not an object, with the file named on parse errors", () => {
    expect(() => loadDataFile(write("d.json", "[1, 2]"))).toThrow(/JSON object/);
    expect(() => loadDataFile(write("d.json", "{not json"))).toThrow(/invalid JSON in .*d\.json/);
  });

  it("loads a JSON null as an unobserved entry", () => {
    expect(loadDataFile(write("d.json", JSON.stringify({ y: [1, null, 3] })))).toEqual({
      y: [1, null, 3],
    });
  });

  it("turns CSV columns into numeric vectors with a derived N", () => {
    const path = write("d.csv", "y,x\n1.2,0\n0.8,1\n1.5,0\n");
    expect(loadDataFile(path)).toEqual({ y: [1.2, 0.8, 1.5], x: [0, 1, 0], N: 3 });
  });

  it("handles quoted fields and rejects non-numeric CSV cells", () => {
    expect(loadDataFile(write("d.csv", 'y\n"1.2"\n"1e3"\n'))).toEqual({ y: [1.2, 1000], N: 2 });
    expect(() => loadDataFile(write("d.csv", "label,y\na,1\n"))).toThrow(
      /column "label" at row 2.*not numeric/,
    );
  });

  it("reads an empty cell and an NA as unobserved", () => {
    expect(loadDataFile(write("d.csv", 'y\n1\n""\n2\n'))).toEqual({ y: [1, null, 2], N: 3 });
    expect(loadDataFile(write("d.csv", "y,x\n1,\n"))).toEqual({ y: [1], x: [null], N: 1 });
    expect(loadDataFile(write("d.csv", "y\n1\nNA\nna\n"))).toEqual({ y: [1, null, null], N: 3 });
  });

  it("rejects ragged rows and duplicate headers", () => {
    expect(() => loadDataFile(write("d.csv", "y,x\n1,2,3\n"))).toThrow(
      /row 2 .* has 3 cells, expected 2/,
    );
    expect(() => loadDataFile(write("d.csv", "y,y\n1,2\n"))).toThrow(/duplicate CSV column "y"/);
  });

  it("does not override an explicit N column", () => {
    const path = write("d.csv", "N,y\n10,1\n20,2\n");
    expect(loadDataFile(path)).toEqual({ N: [10, 20], y: [1, 2] });
  });

  it("rejects unknown extensions", () => {
    expect(() => loadDataFile(write("d.yaml", "y: 1"))).toThrow(/unsupported data file/);
  });
});

describe("missingVariables", () => {
  it("names only the variables holding an unobserved entry, in data order", () => {
    expect(missingVariables({ N: 3, y: [1, 2, 3] })).toEqual([]);
    expect(
      missingVariables({
        N: 2,
        t: [
          [1, null],
          [2, 3],
        ],
        cen: [0, 4],
        mu: null,
      }),
    ).toEqual(["t", "mu"]);
  });
});

describe("missingDataRefusal", () => {
  it("lets a Julia backend take an unobserved entry", () => {
    expect(
      missingDataRefusal("juliabugs", {
        N: 2,
        t: [
          [1, null],
          [2, 3],
        ],
      }),
    ).toBeUndefined();
    expect(missingDataRefusal("turing", { y: [1, null] })).toBeUndefined();
  });

  it("refuses one on stan, naming the variables and the Stan idiom", () => {
    expect(missingDataRefusal("stan", { N: 2, y: [1, 2] })).toBeUndefined();
    expect(missingDataRefusal("stan", { t: [1, null], y: [null, 2] })).toMatch(
      /stan backend cannot read an unobserved entry, and t, y have one.*indicator/s,
    );
    expect(missingDataRefusal("stan", { y: [1, null] })).toMatch(/y has one/);
  });
});

describe("resolveData", () => {
  it("returns validated inline data unchanged when no file is given", () => {
    expect(resolveData({ x: [1, 2] })).toEqual({ data: { x: [1, 2] } });
  });

  it("loads a file and hashes its bytes", () => {
    const path = write("data.csv", "y\n1\n2\n3\n");
    const r = resolveData({}, path);
    expect(r.dataFile).toBe(path);
    expect(r.data).toMatchObject({ y: [1, 2, 3], N: 3 });
    expect(r.dataSha256).toBe(createHash("sha256").update(readFileSync(path)).digest("hex"));
  });
});
