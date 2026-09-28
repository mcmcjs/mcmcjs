# Notebooks

The notebooks the editor's **Open in Colab** button links to.
Colab can only open a notebook from GitHub or Drive, never from the page it is running on, so these are committed rather than produced in the browser.

They are generated, not written by hand:

```
pnpm gen:notebooks
```

Each one is a template: an empty slot for the graph that the Run tab's **Copy graph** puts on the clipboard, then the same `mcmc` workflow for whatever graph is pasted in.
`packages/doodleppl-ui/test/notebooks.test.ts` fails if they drift from the generator.

The Stan notebook runs on Colab's Python runtime and the JuliaBUGS one on its Julia runtime.
Expect the first run to take several minutes on a fresh runtime, while CmdStan builds or the Julia packages precompile.
