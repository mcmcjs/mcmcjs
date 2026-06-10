import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDataFile } from "../src/data-file";

const write = (name: string, text: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "mcmcjs-data-"));
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
};

describe("loadDataFile", () => {
  it("loads a JSON object verbatim", () => {
    const path = write("d.json", JSON.stringify({ J: 8, y: [28, 8], sigma: [15, 10] }));
    expect(loadDataFile(path)).toEqual({ J: 8, y: [28, 8], sigma: [15, 10] });
  });

  it("rejects JSON that is not an object, with the file named on parse errors", () => {
    expect(() => loadDataFile(write("d.json", "[1, 2]"))).toThrow(/JSON object/);
    expect(() => loadDataFile(write("d.json", "{not json"))).toThrow(/invalid JSON in .*d\.json/);
  });

  it("rejects null values in JSON data, naming the path", () => {
    expect(() => loadDataFile(write("d.json", JSON.stringify({ y: [1, null, 3] })))).toThrow(
      /null value at y\[1\]/,
    );
  });

  it("turns CSV columns into vectors with numeric coercion and a derived N", () => {
    const path = write("d.csv", "y,x\n1.2,0\n0.8,1\n1.5,0\n");
    expect(loadDataFile(path)).toEqual({ y: [1.2, 0.8, 1.5], x: [0, 1, 0], N: 3 });
  });

  it("handles quoted fields, keeps non-numeric strings, and coerces strictly", () => {
    const path = write("d.csv", 'label,y\n"a,b",1\n"say ""hi""",1e3\nInfinity,0x10\n');
    expect(loadDataFile(path)).toEqual({
      label: ["a,b", 'say "hi"', "Infinity"],
      y: [1, 1000, "0x10"],
      N: 3,
    });
  });

  it("rejects empty cells, naming the column, row, and file", () => {
    expect(() => loadDataFile(write("d.csv", 'y\n1\n""\n2\n'))).toThrow(
      /empty cell in column "y" at row 3/,
    );
    expect(() => loadDataFile(write("d.csv", "y,x\n1,\n"))).toThrow(
      /empty cell in column "x" at row 2/,
    );
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
