---
"mcmcjs": minor
---

Fix `mcmc sandbox` exit handling and make the keep decision scriptable. Ctrl+C or Ctrl+D at the keep prompt no longer kills the process mid-decision and orphans the temp directory silently; it now leaves the sandbox in place and prints where it is (a panic key never deletes). The prompt wording is clearer (Enter or n deletes, y keeps), and new flags pre-decide without prompting: `--keep`, `--delete`, and `--keep-dir <path>` / `--name <n>` to keep and relocate the sandbox (copied then removed, so it works across filesystems).
