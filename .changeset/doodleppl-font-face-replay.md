---
"doodleppl": patch
---

Fix invisible icons in 0.4.0: the primeicons `@font-face` never reached the document (its SVG font data contains literal braces that broke the regex-based extraction), leaving the edit, minimize, and toast-close glyphs blank. Font rules are now extracted with a real CSS parse and replayed into the head, where browsers require them.
