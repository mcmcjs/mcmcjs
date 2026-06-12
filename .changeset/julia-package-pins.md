---
"@mcmcjs/julia": minor
---

Support managed-package version pins: managedProjectDir/managedProjectReady/ensureProject take a PackagePins map, key the env by the pins, install pinned versions via Pkg.PackageSpec, and reject pins for unmanaged packages.
