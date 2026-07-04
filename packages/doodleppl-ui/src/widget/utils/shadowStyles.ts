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

// The dark-mode class the widget toggles; matches PrimeVue's configured
// darkModeSelector (see element.ts) and every .db-dark-mode rule in the styles.
const DARK_SELECTOR = '.db-dark-mode'

/**
 * PrimeVue anchors its design tokens at `:root, :host` and remaps the dark ones
 * under `.db-dark-mode`. Inside the overlay shadow root that class only sits on
 * the mount (a descendant of the host), so tokens defined through var() at :host
 * scope, such as `--p-accordion-header-background: var(--p-content-background)`,
 * resolve against the light base at the host and inherit down as fixed light
 * values, leaving teleported PrimeVue chrome light in dark mode. Re-emitting the
 * dark token remaps at `:host(.db-dark-mode)` turns the anchor itself dark (and
 * its higher specificity beats the `:root, :host` base regardless of order); the
 * widget mirrors the class onto the overlay host so the selector matches.
 */
function hostScopedDarkTokens(): string {
  const blocks: string[] = []
  for (const el of document.head.querySelectorAll<HTMLStyleElement>(
    'style[data-primevue-style-id]'
  )) {
    const sheet = el.sheet
    if (!sheet) continue
    try {
      for (const rule of sheet.cssRules) {
        if (rule instanceof CSSStyleRule && rule.selectorText === DARK_SELECTOR) {
          blocks.push(rule.style.cssText)
        }
      }
    } catch {
      // A sheet that has not parsed yet is picked up on the next sync.
    }
  }
  return blocks.length > 0 ? `:host(${DARK_SELECTOR}){${blocks.join(';')}}` : ''
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
  const darkHost = document.createElement('style')
  darkHost.setAttribute('data-doodleppl-dark-host', '')
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
    // :host(.db-dark-mode) outspecs the :root, :host base, so source order does
    // not matter; only attach the element once there is something to emit.
    const css = hostScopedDarkTokens()
    if (css) {
      if (darkHost.parentNode !== root) root.appendChild(darkHost)
      if (darkHost.textContent !== css) darkHost.textContent = css
    } else if (darkHost.parentNode === root) {
      root.removeChild(darkHost)
    }
  }
  sync()
  const observer = new MutationObserver(sync)
  observer.observe(document.head, { childList: true, subtree: true, characterData: true })
  return () => observer.disconnect()
}
