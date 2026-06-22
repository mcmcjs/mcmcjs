import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDataFile, resolveData, validateCanonicalData } from "../src/data";

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

  it("rejects non-finite, non-numeric, and missing values, naming the path", () => {
    expect(() => validateCanonicalData({ y: [1, Number.NaN] })).toThrow(/y\[1\].*finite/);
    expect(() => validateCanonicalData({ a: Number.POSITIVE_INFINITY })).toThrow(/a.*finite/);
    expect(() => validateCanonicalData({ s: "x" })).toThrow(/s.*numbers or nested numeric arrays/);
    expect(() => validateCanonicalData({ y: [1, null, 3] })).toThrow(/y\[1\].*missing/);
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

  it("rejects missing values in JSON data, naming the path", () => {
    expect(() => loadDataFile(write("d.json", JSON.stringify({ y: [1, null, 3] })))).toThrow(
      /y\[1\].*missing/,
    );
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

  it("rejects empty cells, naming the column, row, and file", () => {
    expect(() => loadDataFile(write("d.csv", 'y\n1\n""\n2\n'))).toThrow(
      /column "y" at row 3.*empty/,
    );
    expect(() => loadDataFile(write("d.csv", "y,x\n1,\n"))).toThrow(/column "x" at row 2.*empty/);
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
