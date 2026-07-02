// The overlay chrome renders inside a shadow root at body level, out of reach of
// document.head styles. Two sources have to be replayed into that root: the bundle's
// own CSS (recorded by the injectCodeFunction in vite.config.ts) and PrimeVue's
// runtime-injected theme and component styles.

const cssRegistry = (): string[] => {
  const g = globalThis as { __DOODLEPPL_CSS__?: string[] }
  g.__DOODLEPPL_CSS__ = g.__DOODLEPPL_CSS__ || []
  return g.__DOODLEPPL_CSS__
}

const FONT_IMPORT_RE = /@import[^;]+;/g

// Browsers only honor @font-face at document level, so those rules (and the font
// @imports) are replayed into the head. Extraction needs a real CSS parse: the
// primeicons face embeds an SVG font whose data URI contains literal braces, which
// no brace-matching regex survives. Module-level counter: once per chunk, however
// many widget instances exist.
let fontChunksProcessed = 0
const ensureDocumentFonts = (): void => {
  const list = cssRegistry()
  for (; fontChunksProcessed < list.length; fontChunksProcessed++) {
    const css = list[fontChunksProcessed]
    const parts: string[] = css.match(FONT_IMPORT_RE) ?? []
    try {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(css.replace(FONT_IMPORT_RE, ''))
      for (const rule of sheet.cssRules) {
        if (rule instanceof CSSFontFaceRule) parts.push(rule.cssText)
      }
    } catch {
      // Constructable stylesheets unavailable: the @imports above still register.
    }
    if (parts.length > 0) {
      const style = document.createElement('style')
      style.setAttribute('data-doodleppl-fonts', '')
      style.textContent = parts.join('\n')
      document.head.appendChild(style)
    }
  }
}

/** Copy every bundle stylesheet into the root, following late-loaded chunks. */
export function adoptBundleCss(root: ShadowRoot): () => void {
  let adopted = 0
  const apply = () => {
    ensureDocumentFonts()
    const list = cssRegistry()
    for (; adopted < list.length; adopted++) {
      const style = document.createElement('style')
      style.setAttribute('data-doodleppl-bundle-css', '')
      style.textContent = list[adopted]
      root.appendChild(style)
    }
  }
  apply()
  document.addEventListener('doodleppl:css', apply)
  return () => document.removeEventListener('doodleppl:css', apply)
}

/**
 * Mirror PrimeVue's head styles into the root. Component styles load lazily on each
 * component type's first mount and theme styles are rewritten in place on theme
 * changes, so a one-shot copy is not enough; the mirror clones (never moves — the
 * overlay panels PrimeVue portals to document.body still need the originals) and
 * keeps following head mutations.
 */
export function mirrorPrimeVueStyles(root: ShadowRoot): () => void {
  const clones = new Map<string, HTMLStyleElement>()
  const copy = (source: HTMLStyleElement) => {
    const id = source.getAttribute('data-primevue-style-id')
    if (!id) return
    let clone = clones.get(id)
    if (!clone) {
      clone = document.createElement('style')
      clone.setAttribute('data-primevue-style-id', id)
      root.appendChild(clone)
      clones.set(id, clone)
    }
    if (clone.textContent !== source.textContent) clone.textContent = source.textContent
  }
  const sync = () => {
    for (const el of document.head.querySelectorAll<HTMLStyleElement>(
      'style[data-primevue-style-id]'
    )) {
      copy(el)
    }
  }
  sync()
  const observer = new MutationObserver(sync)
  observer.observe(document.head, { childList: true, subtree: true, characterData: true })
  return () => observer.disconnect()
}
