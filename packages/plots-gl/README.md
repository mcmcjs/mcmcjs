# @mcmcjs/plots-gl

Interactive WebGL renderers for MCMC plots: a 3D point cloud (`scatter3d`), a scatter-plot matrix (`splom`), and parallel coordinates (`parallel-coords`).

These are browser-only renderers backed by [`regl`](https://github.com/regl-project/regl), which is an optional peer dependency. Install it alongside this package when you use the renderers.

Each renderer mounts into a live DOM element and returns a handle for updating and teardown, mirroring `@mcmcjs/charts/dom`. The data they consume is built by the dependency-free `@mcmcjs/plots` package, so the terminal, SVG, and HTML backends never pull in WebGL.

```bash
pnpm add @mcmcjs/plots-gl @mcmcjs/plots regl
```

The mount functions are async because regl is loaded on demand. Pass `{ regl }` to inject the factory instead of relying on the dynamic import.

```ts
import { scatter3dData } from "@mcmcjs/plots";
import { mountScatter3d } from "@mcmcjs/plots-gl";

const data = scatter3dData(samples, "alpha", "beta", "sigma");
const handle = await mountScatter3d(document.getElementById("plot"), data);
// later: handle.destroy();
```
