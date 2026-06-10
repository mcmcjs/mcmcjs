# @mcmcjs/doodlebugs

## 0.1.0

### Minor Changes

- 9f8c973: Add the JuliaBUGS standalone-script generator (`generateStandaloneScript`), ported from the editor and verified byte-for-byte against its output on the bundled example graphs, alongside reference fixtures that also pin `generateBugsModel` to the editor's exact output.
- 25eb23b: Port the BUGS distribution catalog (26 distributions with parameter metadata), the built-in function set, and the graph validator (`validateGraph`) from the editor, so validation and authoring metadata live in the shared core.
- 9fc2bf3: Initial release: parse DoodleBUGS graphs and generate BUGS model code (graph data model, topological sort, and the graph-to-`model { ... }` codegen ported from the editor), so the codegen has one shared home.
- 514a2e5: Add zod schemas for the graph format (`UnifiedModelDataSchema` and friends) and publish a generated JSON Schema artifact at `@mcmcjs/doodlebugs/graph.schema.json` so any consumer can validate graphs without importing the package.
- 3008951: Add the Stan generator as a `./stan` subpath export (model code, data and inits JSON, and a CmdStanPy run script), ported from the editor and verified byte-for-byte against its output on the twelve bundled example graphs.
