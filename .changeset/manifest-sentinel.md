---
"@mcmcjs/julia": patch
---

Re-provision a managed Julia environment whenever the shipped Manifest is resolved anew, rather than when a hand-maintained counter changes, so an environment can no longer keep an older resolve
