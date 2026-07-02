---
"doodleppl": patch
---

Ship the type declarations at the documented path: 0.1.1 published them under `dist/src/`, so TypeScript consumers resolved no types. Declarations are now emitted by `vue-tsc` alongside the build.
