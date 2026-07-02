---
"doodleppl": minor
---

Render the editor canvas inside a shadow root so host page CSS cannot restyle it, and stop the widget from restyling the host page: the global `body`, `#app`, scrollbar, and placeholder rules are removed or scoped to the widget's own surfaces.
