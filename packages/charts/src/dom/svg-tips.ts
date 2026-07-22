/** Hover styles for `[data-tip]` marks; include once wherever plot SVGs mount. */
export const SVG_TIPS_CSS =
  "svg [data-tip]{cursor:default}" +
  "svg [data-tip]:hover{filter:brightness(1.15)}" +
  "svg path[data-tip]:hover{stroke-opacity:1;stroke-width:2.5}";

/**
 * Delegated tooltip over every `[data-tip]` mark under `container`, styled to
 * match the uPlot cursor tooltip. Returns a detach function. Must stay fully
 * self-contained: the offline HTML export inlines it via Function.toString().
 */
export function attachSvgTips(container: HTMLElement): () => void {
  const doc = container.ownerDocument;
  let tip: HTMLDivElement | null = null;
  const ensure = (): HTMLDivElement => {
    if (!tip) {
      tip = doc.createElement("div");
      tip.style.cssText =
        "position:fixed;z-index:100;pointer-events:none;display:none;" +
        "border-radius:7px;padding:8px 11px;font:12px ui-sans-serif,system-ui,sans-serif;" +
        "white-space:pre;line-height:1.5;box-shadow:0 4px 16px rgba(0,0,0,0.4);" +
        "background:var(--mcmc-tip-bg,#ffffff);" +
        "color:var(--mcmc-tip-fg,#1a1a1a);" +
        "border:1px solid var(--mcmc-tip-border,rgba(0,0,0,0.12))";
      doc.body.appendChild(tip);
    }
    return tip;
  };
  const move = (event: PointerEvent): void => {
    const target = event.target instanceof Element ? event.target.closest("[data-tip]") : null;
    if (!target || !container.contains(target)) {
      if (tip) tip.style.display = "none";
      return;
    }
    const el = ensure();
    el.textContent = target.getAttribute("data-tip") ?? "";
    el.style.display = "block";
    const viewWidth = doc.defaultView ? doc.defaultView.innerWidth : 10000;
    const rect = el.getBoundingClientRect();
    el.style.left = `${Math.min(event.clientX + 14, viewWidth - rect.width - 8)}px`;
    el.style.top = `${Math.max(8, event.clientY - rect.height - 12)}px`;
  };
  const leave = (): void => {
    if (tip) tip.style.display = "none";
  };
  container.addEventListener("pointermove", move);
  container.addEventListener("pointerleave", leave);
  return () => {
    container.removeEventListener("pointermove", move);
    container.removeEventListener("pointerleave", leave);
    if (tip) tip.remove();
    tip = null;
  };
}
