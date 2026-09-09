# Notebooks

The notebooks the editor's **Open in Colab** button links to. Colab can only open a
notebook from GitHub or Drive, never from the page it is running on, so these are
committed rather than produced in the browser.

They are generated, not written by hand:

```
pnpm gen:notebooks
```

Each one is what the Run tab produces for the bundled Rats example, so a reader can
click through to a notebook that runs end to end and see the shape their own model's
notebook will take. `packages/doodleppl-ui/test/notebooks.test.ts` fails if they drift
from the generator.

Both use the Python kernel, which is what Colab gives you: Stan through CmdStanPy, and
JuliaBUGS through juliacall, which installs Julia on first use. Expect the first cell to
take several minutes on a fresh runtime.
