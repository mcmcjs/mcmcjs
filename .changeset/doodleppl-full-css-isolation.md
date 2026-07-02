---
"doodleppl": minor
---

Complete the CSS isolation in both directions: dialogs, select panels, and popovers now render inside the overlay shadow root via `appendTo`, toasts get an in-shadow display on the same toast service (PrimeVue's Toast cannot be re-targeted), and inherited text properties are reset at each shadow boundary. In the other direction the widget no longer injects its bundle CSS into the host document at all; only font registrations reach `document.head` (browsers ignore `@font-face` inside shadow roots), so the utility classes, CodeMirror styles, root token overrides, and PrimeVue input tweaks that previously leaked into host pages are gone. Tooltips remain the one light-DOM overlay (armored), since the tooltip directive has no retarget option.
