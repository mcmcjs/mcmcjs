---
"doodleppl": patch
---

Fix dark mode painting the widget and its overlay solid red: toast and grid dark-mode selectors used :global() with a descendant selector, which Vue's scoped-CSS compiler compiles to a bare global .db-dark-mode rule.
