import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const vueFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".vue"))
    .map((entry) => join(entry.parentPath, entry.name));

describe("scoped styles", () => {
  // Vue's scoped-CSS compiler only supports :global() around a whole selector;
  // anything after it is silently dropped, shipping the declarations under a
  // bare global selector (the dark-mode toast rules once painted the widget
  // root and overlay solid red this way).
  it("never combines :global() with a descendant selector", () => {
    const offenders: string[] = [];
    for (const file of vueFiles(join(__dirname, "../src"))) {
      const lines = readFileSync(file, "utf8").split("\n");
      for (const [index, line] of lines.entries()) {
        if (/:global\([^)]*\)\s*[^\s,{]/.test(line)) {
          offenders.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
