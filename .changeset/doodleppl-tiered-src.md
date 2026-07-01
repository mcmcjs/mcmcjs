---
"@mcmcjs/doodleppl": minor
---

Rename the package to `@mcmcjs/doodleppl` (from `@mcmcjs/doodlebugs`), since it generates code for multiple probabilistic programming languages, and reorganize the source into tiers: a `core/` layer (graph types, schema, catalog, validation, topological sort) and a `codegen/` layer (per-target generators: BUGS, Stan, and the JuliaBUGS run-script). Adds a `@mcmcjs/doodleppl/core` subpath for the graph domain layer without any code generation; the root entry and the `@mcmcjs/doodleppl/stan` subpath export the same symbols as before.
