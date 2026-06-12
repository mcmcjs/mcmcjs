---
"@mcmcjs/julia": minor
---

Key the managed Julia environment by version (managedProjectDir(version)) so each Julia version resolves its own compatible Manifest; runMatrix now provisions per version via an injected ensure callback instead of sharing one env.
