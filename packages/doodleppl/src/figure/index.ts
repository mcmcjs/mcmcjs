/**
 * Black-and-white figures of a graph document, for papers and slides: TikZ for
 * LaTeX, and SVG drawn to match. Nodes keep the positions they have in the
 * document, so a figure shows the arrangement drawn in the editor.
 */

export { type Label, type LabelPart, labelTex, labelText, nodeLabel } from "./label";
export {
  type FigureEdge,
  type FigureLayout,
  type FigureNode,
  type FigureNodeKind,
  type FigureOptions,
  type FigurePlate,
  figureLayout,
} from "./layout";
export { figureSvg, layoutToSvg } from "./svg";
export { figureTikz, layoutToTikz, type TikzOptions } from "./tikz";
