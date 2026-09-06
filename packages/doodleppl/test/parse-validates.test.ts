import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateGraph } from "../src/core/validate";
import { graphFromStanAst, parseBugs } from "../src/parse";

// Every graph the parsers produce for the example programs must pass the
// editor's validator, so a rule written for hand-drawn graphs cannot quietly
// flag a construct the parsers render correctly (hybrid observed nodes,
// corner constraints beside a plate from 2, Stan function names, 1.0E-6).

interface BugsFixture {
  key: string;
  program: string;
  data_keys: string[];
}
interface StanFixture {
  key: string;
  program: string;
  data_keys: string[];
  ast: string | null;
}

const bugs: BugsFixture[] = JSON.parse(
  readFileSync(join(__dirname, "fixtures/bugs-programs.json"), "utf8"),
);
const stan: StanFixture[] = JSON.parse(
  readFileSync(join(__dirname, "fixtures/stan-asts.json"), "utf8"),
);

// The package fixture carries data keys, not values; a placeholder per key is
// what the validator needs to know a variable is supplied.
const placeholders = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, 0]));

describe("every parsed BUGS example validates", () => {
  for (const f of bugs) {
    it(`${f.key} has no validation issues`, () => {
      const data = placeholders(f.data_keys);
      const { model } = parseBugs(f.program, { name: f.key, dataKeys: f.data_keys, data });
      expect(validateGraph(model.elements ?? [], data, { language: "bugs" })).toEqual([]);
    });
  }
});

describe("every parsed Stan example validates", () => {
  for (const f of stan) {
    it(`${f.key} has no validation issues`, () => {
      const data = placeholders(f.data_keys);
      const { model } = graphFromStanAst(f.ast ?? "", { name: f.key, data });
      expect(validateGraph(model.elements ?? [], data, { language: "stan" })).toEqual([]);
    });
  }
});
