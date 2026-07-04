---
"doodleppl": patch
---

Fix teleported PrimeVue chrome (left-sidebar accordion, dropdowns, and overlay panels) staying light in dark mode: re-emit PrimeVue's dark token remaps at `:host` scope in the overlay shadow root so its `:host`-anchored design tokens turn dark, and mirror the dark class onto the overlay host.
