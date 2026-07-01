---
"@mcmcjs/doodlebugs": minor
---

Reorganize the flat source into tiers for a multi-engine codegen library: a `core/` layer (graph types, schema, catalog, validation, topological sort) and a `codegen/` layer (per-target generators: BUGS, Stan, and the JuliaBUGS run-script). Adds a new `@mcmcjs/doodlebugs/core` subpath for the graph domain layer without any code generation. The root entry and the `@mcmcjs/doodlebugs/stan` subpath keep exporting the same symbols, so existing consumers are unaffected.
