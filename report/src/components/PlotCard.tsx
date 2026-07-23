import { attachSvgTips, mountPlot, SVG_TIPS_CSS } from "@mcmcjs/charts/dom";
import { htmlItemFor, type PlotData } from "@mcmcjs/plots";
import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { ResolvedTheme } from "../lib/theme";

let tipsCssInjected = false;
function injectTipsCss(): void {
  if (tipsCssInjected) return;
  const style = document.createElement("style");
  style.textContent = SVG_TIPS_CSS;
  document.head.appendChild(style);
  tipsCssInjected = true;
}

export function PlotCard({
  data,
  theme,
  height,
}: {
  data: PlotData;
  theme: ResolvedTheme;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    injectTipsCss();
    const item = htmlItemFor(data);
    if (item.mode === "uplot") {
      const handle = mountPlot(el, item.spec, {
        uPlot,
        height: height ?? 260,
        interactive: true,
        theme,
      });
      return () => handle.destroy();
    }
    el.innerHTML = item.svg;
    const detach = attachSvgTips(el);
    return () => {
      detach();
      el.innerHTML = "";
    };
  }, [data, theme, height]);

  return <div className="plot-card" ref={ref} />;
}
