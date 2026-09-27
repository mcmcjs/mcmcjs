import type { NodeSingular, StylesheetJson } from 'cytoscape'
import { labelSize, labelSvg, mathSvg, nodeLabel } from '@mcmcjs/doodleppl/figure'

// The canvas drawn like the Figure for Papers export: black and white, circles for
// random nodes, shaded observed nodes, double circles for deterministic nodes,
// squares for constants, and names typeset as maths.

const FONT_SIZE = 20
const LOOP_FONT_SIZE = 13
const NODE_SIZE = 48
const PADDING = 4
/** px per cm of `labelSize`, which measures at a 10pt body, for a name set at FONT_SIZE. */
const PX_PER_CM = (96 / 2.54) * (FONT_SIZE / (40 / 3))

interface Palette {
  ink: string
  paper: string
  shade: string
  faint: string
}

const LIGHT: Palette = { ink: '#111111', paper: '#ffffff', shade: '#cccccc', faint: '#666666' }
const DARK: Palette = { ink: '#e5e7eb', paper: '#18181b', shade: '#52525b', faint: '#a1a1aa' }

interface Image {
  url: string
  width: number
  height: number
}

const images = new Map<string, Image>()

/** An SVG as a data URL, made once per key. */
function cached(key: string, make: () => { svg: string; width: number; height: number }): Image {
  let image = images.get(key)
  if (!image) {
    const { svg, width, height } = make()
    let binary = ''
    for (const byte of new TextEncoder().encode(svg)) binary += String.fromCharCode(byte)
    image = { url: `data:image/svg+xml;base64,${btoa(binary)}`, width, height }
    images.set(key, image)
  }
  return image
}

/** A node's typeset name, drawn four times larger so it stays sharp when zoomed. */
function nameImage(ele: NodeSingular, color: string): Image {
  const name = String(ele.data('name') ?? '')
  const indices = ele.data('indices') as string | undefined
  return cached(`name\u0000${name}\u0000${indices ?? ''}\u0000${color}`, () =>
    labelSvg(nodeLabel(name, indices), { fontSize: FONT_SIZE, color, pixelRatio: 4 })
  )
}

/** A plate's loop, `i = 1, …, N`, typeset for its bottom right corner. */
function loopImage(ele: NodeSingular, color: string): Image {
  const text = plateLabel(ele)
  return cached(`loop\u0000${text}\u0000${color}`, () =>
    mathSvg(text, { fontSize: LOOP_FONT_SIZE, color, pixelRatio: 4 })
  )
}

/** Circles grow to fit a long name, as the figure's do, and constants widen. */
function outline(ele: NodeSingular) {
  const text = labelSize(nodeLabel(String(ele.data('name') ?? ''), ele.data('indices')))
  const w = text.width * PX_PER_CM
  const h = text.height * PX_PER_CM
  if (ele.data('nodeType') === 'constant') {
    const side = NODE_SIZE * 0.85
    return { width: Math.max(side, w + 2 * PADDING), height: Math.max(side, h + 2 * PADDING) }
  }
  const d = Math.max(NODE_SIZE, 2 * Math.hypot(w / 2 + PADDING, h / 2 + PADDING))
  return { width: d, height: d }
}

function plateLabel(ele: NodeSingular): string {
  const variable = String(ele.data('loopVariable') || 'i')
  const range = String(ele.data('loopRange') ?? '').trim()
  const colon = range.indexOf(':')
  if (colon > 0) {
    return `${variable} = ${range.slice(0, colon).trim()}, …, ${range.slice(colon + 1).trim()}`
  }
  return range ? `${variable} ∈ ${range}` : variable
}

/** Rules drawn over the editor's own styles when paper style is on. */
export function paperStyles(dark: boolean): StylesheetJson {
  const c = dark ? DARK : LIGHT
  return [
    {
      selector: 'node[nodeType != "plate"]',
      style: {
        'background-color': c.paper,
        'background-opacity': 1,
        'border-color': c.ink,
        'border-width': 1.5,
        'border-style': 'solid',
        shape: 'ellipse',
        width: (ele: NodeSingular) => outline(ele).width,
        height: (ele: NodeSingular) => outline(ele).height,
        label: '',
        'background-image': (ele: NodeSingular) => nameImage(ele, c.ink).url,
        'background-width': (ele: NodeSingular) => `${nameImage(ele, c.ink).width}px`,
        'background-height': (ele: NodeSingular) => `${nameImage(ele, c.ink).height}px`,
        'background-fit': 'none',
        'background-clip': 'none',
        'background-image-containment': 'over',
      },
    },
    {
      selector: 'node[nodeType = "observed"], node[?observed]',
      style: { 'background-color': c.shade },
    },
    {
      selector: 'node[nodeType = "deterministic"]',
      style: { 'border-style': 'double', 'border-width': 5 },
    },
    {
      selector: 'node[nodeType = "constant"]',
      style: { shape: 'rectangle' },
    },
    {
      selector: 'node[nodeType = "plate"]',
      style: {
        shape: 'round-rectangle',
        'background-opacity': 0,
        'border-color': c.faint,
        'border-width': 1,
        'border-style': 'solid',
        label: '',
        // The loop sits in the bottom right corner, with room kept for it below the members.
        'background-image': (ele: NodeSingular) => loopImage(ele, c.faint).url,
        'background-width': (ele: NodeSingular) => `${loopImage(ele, c.faint).width}px`,
        'background-height': (ele: NodeSingular) => `${loopImage(ele, c.faint).height}px`,
        'background-fit': 'none',
        'background-position-x': '100%',
        'background-position-y': '100%',
        'background-offset-x': -2,
        'background-offset-y': -1,
        padding: '26px',
      },
    },
    {
      selector: 'edge',
      style: {
        'line-color': c.ink,
        'target-arrow-color': c.ink,
        'line-style': 'solid',
        width: 1.5,
        'target-arrow-shape': 'triangle-backcurve',
        'arrow-scale': 1.3,
      },
    },
  ]
}
