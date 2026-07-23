import { seriesColor } from "@mcmcjs/charts";
import type { Samples } from "@mcmcjs/core";
import {
  autocorrData,
  cornerData,
  densityData,
  diagnosticsHeatmapData,
  energyData,
  forestData,
  rankData,
  summaryTableData,
  traceData,
} from "@mcmcjs/plots";
import { useMemo, useState } from "react";
import type { StoredRun } from "../lib/db";
import { bundleTitle, downloadBundle, samplesOf, subsetChains } from "../lib/runs";
import type { ResolvedTheme } from "../lib/theme";
import { PlotCard } from "./PlotCard";

const CORNER_MAX_VARS = 8;

export function RunView({
  run,
  onBack,
  theme,
  onToggleTheme,
  themeLabel,
}: {
  run: StoredRun;
  onBack: () => void;
  theme: ResolvedTheme;
  onToggleTheme: () => void;
  themeLabel: string;
}) {
  const bundle = run.bundle;
  const entry = bundle.entry;
  const full = useMemo(() => samplesOf(bundle), [bundle]);
  const [keep, setKeep] = useState<boolean[]>(() => new Array(full.nChains).fill(true));
  const samples: Samples = useMemo(() => subsetChains(full, keep), [full, keep]);
  const [variable, setVariable] = useState<string>(() => full.variables[0] ?? "");

  const energy = useMemo(() => {
    try {
      return energyData(samples);
    } catch {
      return null;
    }
  }, [samples]);
  const corner = useMemo(
    () => cornerData([{ samples }], { vars: [...samples.variables].slice(0, CORNER_MAX_VARS) }),
    [samples],
  );
  const summary = useMemo(() => summaryTableData(samples), [samples]);
  const heatmap = useMemo(() => diagnosticsHeatmapData(samples), [samples]);
  const forest = useMemo(() => forestData(samples), [samples]);
  const perVariable = useMemo(() => {
    if (!variable || !samples.variables.includes(variable)) return null;
    return {
      trace: traceData(samples, variable),
      density: densityData(samples, variable),
      rank: rankData(samples, variable),
      autocorr: autocorrData(samples, variable),
    };
  }, [samples, variable]);

  const verdict = entry.diagnostics;
  const toggleChain = (i: number): void => {
    setKeep((prev) => {
      const next = [...prev];
      next[i] = !next[i];
      return next.some(Boolean) ? next : prev;
    });
  };

  return (
    <>
      <header className="run-head">
        <div className="inner">
          <button type="button" className="icon-btn" onClick={onBack}>
            ← runs
          </button>
          <span className="run-title">{bundleTitle(bundle)}</span>
          <span className="run-id">{entry.id}</span>
          {verdict && (
            <span className="chip">
              <span className={`dot ${verdict.converged ? "ok" : "bad"}`} />{" "}
              {verdict.converged ? "converged" : "not converged"}
            </span>
          )}
          <span className="spacer" />
          <button type="button" className="icon-btn" onClick={() => downloadBundle(bundle)}>
            save bundle
          </button>
          <button type="button" className="icon-btn" onClick={onToggleTheme}>
            {themeLabel}
          </button>
        </div>
      </header>

      <div className="shell" style={{ paddingTop: 0 }}>
        <div className="chipset" style={{ marginBottom: 20 }}>
          <span className="chip">
            {entry.backend.id} {entry.backend.version}
          </span>
          <span className="chip">
            {entry.sampler.algorithm} · {entry.sampler.draws} draws × {entry.sampler.chains} chains
            · {entry.sampler.warmup} warmup
          </span>
          <span className="chip">seed {entry.seed}</span>
          <span className="chip">{(entry.elapsed_ms / 1000).toFixed(1)} s</span>
          {verdict?.rhat_max != null && (
            <span className="chip">R-hat max {verdict.rhat_max.toFixed(3)}</span>
          )}
          {verdict?.divergences != null && (
            <span className="chip">{verdict.divergences} divergences</span>
          )}
        </div>

        <div className="chipset" style={{ marginBottom: 28 }}>
          {Array.from({ length: full.nChains }, (_, i) => (
            <button
              type="button"
              key={String(i)}
              className={`pill${keep[i] ? "" : " off"}`}
              onClick={() => toggleChain(i)}
            >
              <span className="swatch" style={{ background: seriesColor(i) }} />
              chain {i + 1}
            </button>
          ))}
        </div>

        <section className="block" style={{ marginTop: 0 }}>
          <p className="eyebrow">Summary</p>
          <PlotCard data={summary} theme={theme} />
        </section>

        <section className="block">
          <p className="eyebrow">Convergence</p>
          <div className="grid-2">
            <PlotCard data={heatmap} theme={theme} />
            <PlotCard data={forest} theme={theme} />
          </div>
        </section>

        <section className="block">
          <p className="eyebrow">Joint posterior</p>
          <PlotCard data={corner} theme={theme} />
          {samples.variables.length > CORNER_MAX_VARS && (
            <p className="tagline">
              corner shows the first {CORNER_MAX_VARS} of {samples.variables.length} variables
            </p>
          )}
          {energy && <PlotCard data={energy} theme={theme} />}
        </section>

        <section className="block">
          <p className="eyebrow">Per variable</p>
          <div className="varbar">
            {samples.variables.map((v) => (
              <button
                type="button"
                key={v}
                className={`pill${v === variable ? "" : " off"}`}
                onClick={() => setVariable(v)}
              >
                {v}
              </button>
            ))}
          </div>
          {perVariable && (
            <div className="grid-2">
              <PlotCard data={perVariable.trace} theme={theme} />
              <PlotCard data={perVariable.density} theme={theme} />
              <PlotCard data={perVariable.rank} theme={theme} />
              <PlotCard data={perVariable.autocorr} theme={theme} />
            </div>
          )}
        </section>

        <section className="block">
          <p className="eyebrow">Model</p>
          <pre className="source">{bundle.model_source}</pre>
        </section>

        <section className="block">
          <p className="eyebrow">Data</p>
          <pre className="source">
            {JSON.stringify((bundle.spec as { data?: unknown }).data ?? {}, null, 2)}
          </pre>
        </section>
      </div>
    </>
  );
}
