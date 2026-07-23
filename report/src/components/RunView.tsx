import { seriesColor } from "@mcmcjs/charts";
import type {
  CornerData,
  DiagnosticsHeatmapData,
  EnergyData,
  ForestData,
  PlotData,
  SummaryTableData,
} from "@mcmcjs/plots";
import { useMemo, useState } from "react";
import { useComputed, useComputeSession } from "../lib/compute";
import type { StoredRun } from "../lib/db";
import { bundleTitle, downloadBundle } from "../lib/runs";
import type { ResolvedTheme } from "../lib/theme";
import { PlotCard } from "./PlotCard";

const CORNER_MAX_VARS = 8;

interface PerVariable {
  trace: PlotData;
  density: PlotData;
  rank: PlotData;
  autocorr: PlotData;
}

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
  const samplesText = useMemo(() => JSON.stringify(bundle.samples), [bundle]);
  const { compute, meta } = useComputeSession(samplesText);

  const [keepState, setKeep] = useState<boolean[] | null>(null);
  const keep = keepState ?? new Array(meta?.nChains ?? 0).fill(true);
  const keepArg = keep.every(Boolean) ? undefined : keep;
  const [variableState, setVariable] = useState<string | null>(null);
  const variable = variableState ?? meta?.variables[0] ?? "";

  const summary = useComputed<SummaryTableData>(compute, "summary", { keep: keepArg });
  const heatmap = useComputed<DiagnosticsHeatmapData>(compute, "heatmap", { keep: keepArg });
  const forest = useComputed<ForestData>(compute, "forest", { keep: keepArg });
  const perVariable = useComputed<PerVariable>(compute, "pervar", { variable, keep: keepArg });
  const energy = useComputed<EnergyData | null>(compute, "energy", { keep: keepArg });
  const corner = useComputed<CornerData>(compute, "corner", {
    cornerMaxVars: CORNER_MAX_VARS,
    keep: keepArg,
  });

  const verdict = entry.diagnostics;
  const toggleChain = (i: number): void => {
    const next = [...keep];
    next[i] = !next[i];
    if (next.some(Boolean)) setKeep(next);
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
          {Array.from({ length: meta?.nChains ?? 0 }, (_, i) => (
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
          <p className="eyebrow">Per variable</p>
          <div className="varbar">
            {(meta?.variables ?? []).map((v) => (
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
          <div className="grid-2">
            <PlotCard data={perVariable?.trace ?? null} theme={theme} />
            <PlotCard data={perVariable?.density ?? null} theme={theme} />
            <PlotCard data={perVariable?.rank ?? null} theme={theme} />
            <PlotCard data={perVariable?.autocorr ?? null} theme={theme} />
          </div>
        </section>

        <section className="block">
          <p className="eyebrow">Joint posterior</p>
          <PlotCard data={corner} theme={theme} />
          {meta && meta.variables.length > CORNER_MAX_VARS && (
            <p className="tagline">
              corner shows the first {CORNER_MAX_VARS} of {meta.variables.length} variables
            </p>
          )}
          {energy && <PlotCard data={energy} theme={theme} />}
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
