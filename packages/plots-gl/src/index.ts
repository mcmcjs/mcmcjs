export {
  DEFAULT_CHAIN_COLORS,
  type GlMountOptions,
  type GlPlotHandle,
  type Regl,
  type ReglFactory,
  resolveRegl,
} from "./common";
export { mat4LookAt, mat4Multiply, mat4Perspective, projectPt } from "./mat4";
export { mountParallelCoords, type ParallelCoordsGlOptions } from "./parallel-coords";
export {
  mountScatter3d,
  projectScatterPoint,
  type Scatter3dGlOptions,
} from "./scatter3d";
export { mountSplom, type SplomGlOptions } from "./splom";
