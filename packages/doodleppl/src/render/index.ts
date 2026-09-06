/**
 * `@mcmcjs/doodleppl/render`: lay out a graph document automatically and draw
 * it as SVG. Browser-safe; the CLI rasterizes the SVG for PNG.
 */

export {
  applyLayout,
  type Layout,
  type LayoutOptions,
  layoutGraph,
  nodeLabel,
  type PlacedEdge,
  type PlacedNode,
  type Point,
} from "./layout";
export { renderGraphSvg, type SvgOptions, type SvgTheme } from "./svg";
