---
"mcmcjs": patch
---

The report handoff link now points at the run's own bundle, so a report app still cached from an earlier version opens the run instead of failing with a 404, and the store server gives up its port when its state file disappears with a discarded sandbox.
