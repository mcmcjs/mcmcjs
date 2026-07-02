---
"doodleppl": patch
---

Fix the CDN build: `doodleppl.global.js` shipped bare `process.env.NODE_ENV` references and threw `process is not defined` when loaded from a script tag; the IIFE now bakes in production mode.
