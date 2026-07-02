import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DrawBatch } from "@mcmcjs/engine";
import { describe, expect, it } from "vitest";
import { columnToLeaf, createStanCsvTail } from "../src/csv";

// The comment/header/adaptation/draws/footer structure CmdStan 2.39 writes.
const HEAD = [
  "# stan_version_major = 2",
  "# model = test_model",
  "lp__,accept_stat__,stepsize__,treedepth__,n_leapfrog__,divergent__,energy__,theta,beta.1,beta.2,M.1.1,M.2.1",
  "# Adaptation terminated",
  "# Step size = 0.7",
].join("\n");

const row = (base: number) =>
  [base, 0.9, 0.7, 3, 7, 0, base + 1, base + 2, base + 3, base + 4, base + 5, base + 6].join(",");

describe("columnToLeaf", () => {
  it("renames kept diagnostics, drops unknown ones, and bracketizes containers", () => {
    expect(columnToLeaf("lp__")).toBe("lp");
    expect(columnToLeaf("divergent__")).toBe("diverging");
    expect(columnToLeaf("something__")).toBeNull();
    expect(columnToLeaf("theta")).toBe("theta");
    expect(columnToLeaf("beta.2")).toBe("beta[2]");
    expect(columnToLeaf("M.2.1")).toBe("M[2,1]");
  });
});

describe("createStanCsvTail", () => {
  it("batches appended draws, skipping comments and partial lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "stan-csv-"));
    const file = join(dir, "chain.csv");
    const batches: DrawBatch[] = [];
    const tail = createStanCsvTail(file, {
      chain: 0,
      batchSize: 2,
      onBatch: (b) => batches.push(b),
    });

    tail.poll(); // file does not exist yet
    expect(batches).toHaveLength(0);

    writeFileSync(file, `${HEAD}\n${row(1)}\n${row(2)}\n`);
    tail.poll();
    expect(batches).toHaveLength(1);
    expect(batches[0]?.chain).toBe(0);
    expect(batches[0]?.seq).toBe(0);
    expect(batches[0]?.draws.lp).toEqual([1, 2]);
    expect(batches[0]?.draws["beta[1]"]).toEqual([4, 5]);
    expect(batches[0]?.draws["M[1,1]"]).toEqual([6, 7]);

    // A partially written line stays buffered until its newline arrives.
    appendFileSync(file, `${row(3)}\n${row(4)}`);
    tail.poll();
    expect(batches).toHaveLength(1);
    appendFileSync(file, "\n# \n#  Elapsed Time: 0 seconds (Total)\n");
    tail.poll();
    expect(batches).toHaveLength(2);
    expect(batches[1]?.seq).toBe(1);
    expect(batches[1]?.draws.lp).toEqual([3, 4]);

    tail.finish();
    expect(batches).toHaveLength(2);
  });

  it("preserves non-finite CmdStan values in streamed draws", () => {
    const dir = mkdtempSync(join(tmpdir(), "stan-csv-"));
    const file = join(dir, "chain.csv");
    const batches: DrawBatch[] = [];
    const tail = createStanCsvTail(file, {
      chain: 0,
      batchSize: 10,
      onBatch: (b) => batches.push(b),
    });
    const specials = ["-inf", 0.9, 0.7, 3, 7, 0, "inf", "nan", 1, 2, 3, 4].join(",");
    writeFileSync(file, `${HEAD}\n${specials}\n`);
    tail.finish();
    expect(batches[0]?.draws.lp).toEqual([Number.NEGATIVE_INFINITY]);
    expect(batches[0]?.draws.energy).toEqual([Number.POSITIVE_INFINITY]);
    expect(batches[0]?.draws.theta?.[0]).toBeNaN();
  });

  it("flushes a final partial batch on finish", () => {
    const dir = mkdtempSync(join(tmpdir(), "stan-csv-"));
    const file = join(dir, "chain.csv");
    const batches: DrawBatch[] = [];
    const tail = createStanCsvTail(file, {
      chain: 1,
      batchSize: 10,
      onBatch: (b) => batches.push(b),
    });
    writeFileSync(file, `${HEAD}\n${row(1)}\n${row(2)}\n${row(3)}\n`);
    tail.finish();
    expect(batches).toHaveLength(1);
    expect(batches[0]?.chain).toBe(1);
    expect(batches[0]?.draws.theta).toEqual([3, 4, 5]);
  });
});
