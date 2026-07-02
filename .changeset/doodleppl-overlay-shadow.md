---
"doodleppl": minor
---

Isolate the editor chrome from host page CSS: the toolbar, sidebars, floating panels, debug console, and context menu now render inside a shadow root on a body-level overlay host (still escaping host stacking contexts like the old body teleport), with the bundle CSS and PrimeVue's runtime styles mirrored in. PrimeVue popups that stay in the page (dialogs, dropdown panels, toasts, tooltips) get armor rules against blanket host resets on their close buttons and text.
