/**
 * `@mcmcjs/doodleppl/parse`: read a program into the graph document the editor
 * and codegen use. BUGS is parsed here; Stan arrives as the AST stanc3 prints.
 */

import { type BuildOptions, type BuildResult, buildGraph, type ParseWarning } from "./graph";
import { parseProgram } from "./parser";

export { BugsSyntaxError } from "./lexer";
export type { Expr, IndexItem, Program, Stmt } from "./parser";
export { parseProgram, printExpr } from "./parser";
export {
  graphFromStanAst,
  parseSexp,
  type StanGraphOptions,
  type StanGraphResult,
} from "./stan";
export type { BuildOptions as ParseBugsOptions, BuildResult as ParseBugsResult, ParseWarning };

/**
 * Parse BUGS source into a graph document. Throws `BugsSyntaxError` on a
 * malformed program; anything the graph format cannot hold is reported in
 * `warnings` rather than lost silently.
 */
export function parseBugs(source: string, options: BuildOptions = {}): BuildResult {
  return buildGraph(parseProgram(source), options);
}
