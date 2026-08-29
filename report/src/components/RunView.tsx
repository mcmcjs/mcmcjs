import { seriesColor } from "@mcmcjs/charts";
import type {
  ChainIntervalsAllData,
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

const SECTIONS = [
  ["overview", "Overview"],
  ["variables", "Variables"],
  ["joint", "Joint posterior"],
  ["model", "Model & data"],
] as const;

type Section = (typeof SECTIONS)[number][0];

interface PerVariable {
  trace: PlotData;
  density: PlotData;
  histogram: PlotData;
  rank: PlotData;
  autocorr: PlotData;
  ecdf: PlotData;
  cumulative: PlotData;
  runningRhat: PlotData;
  violin: PlotData;
  intervals: PlotData;
}

interface JointData {
  splom: PlotData;
  parallel: PlotData;
}

function rhatClass(rhat: number | undefined): string {
  if (rhat == null || Number.isNaN(rhat)) return "na";
  if (rhat <= 1.01) return "ok";
  if (rhat <= 1.05) return "warn";
  return "bad";
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

  const [active, setActive] = useState<Section>("overview");
  const [jointSeen, setJointSeen] = useState(false);
  const [query, setQuery] = useState("");
  const [keepState, setKeep] = useState<boolean[] | null>(null);
  const keep = keepState ?? new Array(meta?.nChains ?? 0).fill(true);
  const keepArg = keep.every(Boolean) ? undefined : keep;
  const [variableState, setVariable] = useState<string | null>(null);
  const variable = variableState ?? meta?.variables[0] ?? "";

  const summary = useComputed<SummaryTableData>(compute, "summary", { keep: keepArg });
  const heatmap = useComputed<DiagnosticsHeatmapData>(compute, "heatmap", { keep: keepArg });
  const forest = useComputed<ForestData>(compute, "forest", { keep: keepArg });
  const intervalsAll = useComputed<ChainIntervalsAllData>(compute, "intervals-all", {
    keep: keepArg,
  });
  const energy = useComputed<EnergyData | null>(compute, "energy", { keep: keepArg });
  const perVariable = useComputed<PerVariable>(compute, "pervar", { variable, keep: keepArg });
  const corner = useComputed<CornerData>(
    compute,
    "corner",
    { cornerMaxVars: CORNER_MAX_VARS, keep: keepArg },
    jointSeen,
  );
  const joint = useComputed<JointData>(compute, "joint", { keep: keepArg }, jointSeen);

  const rhatByVar = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of summary?.rows ?? []) map.set(row.variable, row.rhat);
    return map;
  }, [summary]);

  const variables = meta?.variables ?? [];
  const shown = query
    ? variables.filter((v) => v.toLowerCase().includes(query.toLowerCase()))
    : variables;

  const verdict = entry.diagnostics;
  const toggleChain = (i: number): void => {
    const next = [...keep];
    next[i] = !next[i];
    if (next.some(Boolean)) setKeep(next);
  };
  const goTo = (section: Section): void => {
    setActive(section);
    if (section === "joint") setJointSeen(true);
  };
  const pickVariable = (v: string): void => {
    setVariable(v);
    setActive("variables");
  };

  return (
    <div className="monitor">
      <aside className="side">
        <div className="side-head">
          <button type="button" className="icon-btn" onClick={onBack}>
            ← runs
          </button>
          <div className="run-title">{bundleTitle(bundle)}</div>
          <div className="run-id">{entry.id}</div>
          {verdict && (
            <span className="chip">
              <span className={`dot ${verdict.converged ? "ok" : "bad"}`} />{" "}
              {verdict.converged ? "converged" : "not converged"}
            </span>
          )}
        </div>

        <nav className="side-nav" aria-label="sections">
          {SECTIONS.map(([id, label]) => (
            <button
              type="button"
              key={id}
              className={active === id ? "on" : ""}
              onClick={() => goTo(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="side-vars">
          <p className="eyebrow">Variables</p>
          {variables.length > 8 && (
            <input
              className="var-search"
              type="search"
              placeholder="filter"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          <ul className="var-list">
            {shown.map((v) => {
              const rhat = rhatByVar.get(v);
              return (
                <li key={v}>
                  <button
                    type="button"
                    className={v === variable ? "on" : ""}
                    onClick={() => pickVariable(v)}
                  >
                    <span className={`dot ${rhatClass(rhat)}`} />
                    <span className="var-name">{v}</span>
                    {rhat != null && !Number.isNaN(rhat) && (
                      <span className="rhat">{rhat.toFixed(3)}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="side-chains">
          {Array.from({ length: meta?.nChains ?? 0 }, (_, i) => (
            <button
              type="button"
              key={String(i)}
              className={`pill${keep[i] ? "" : " off"}`}
              onClick={() => toggleChain(i)}
            >
              <span className="swatch" style={{ background: seriesColor(i) }} />
              {i + 1}
            </button>
          ))}
        </div>

        <div className="side-actions">
          <button type="button" className="icon-btn" onClick={() => downloadBundle(bundle)}>
            save bundle
          </button>
          <button type="button" className="icon-btn" onClick={onToggleTheme}>
            {themeLabel}
          </button>
        </div>
      </aside>

      <main className="main">
        {active === "overview" && (
          <>
            <div className="chipset run-meta">
              <span className="chip">
                {entry.backend.id} {entry.backend.version}
              </span>
              <span className="chip">
                {entry.sampler.algorithm} · {entry.sampler.draws} draws × {entry.sampler.chains}{" "}
                chains · {entry.sampler.warmup} warmup
              </span>
              <span className="chip">seed {entry.seed}</span>
              {run.source && <span className="chip">from {run.source}</span>}
              <span className="chip">{(entry.elapsed_ms / 1000).toFixed(1)} s</span>
              {verdict?.rhat_max != null && (
                <span className="chip">R-hat max {verdict.rhat_max.toFixed(3)}</span>
              )}
              {verdict?.divergences != null && (
                <span className="chip">{verdict.divergences} divergences</span>
              )}
            </div>

            <section className="block">
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
              <p className="eyebrow">Credible intervals</p>
              <PlotCard data={intervalsAll} theme={theme} />
            </section>

            {energy && (
              <section className="block">
                <p className="eyebrow">Energy</p>
                <PlotCard data={energy} theme={theme} />
              </section>
            )}
          </>
        )}

        {active === "variables" && (
          <>
            <div className="chipset run-meta">
              <span className="chip mono-strong">{variable}</span>
              {rhatByVar.has(variable) && !Number.isNaN(rhatByVar.get(variable) as number) && (
                <span className="chip">
                  <span className={`dot ${rhatClass(rhatByVar.get(variable))}`} /> R-hat{" "}
                  {(rhatByVar.get(variable) as number).toFixed(3)}
                </span>
              )}
            </div>
            <div className="grid-2">
              <PlotCard data={perVariable?.trace ?? null} theme={theme} />
              <PlotCard data={perVariable?.density ?? null} theme={theme} />
              <PlotCard data={perVariable?.histogram ?? null} theme={theme} />
              <PlotCard data={perVariable?.rank ?? null} theme={theme} />
              <PlotCard data={perVariable?.autocorr ?? null} theme={theme} />
              <PlotCard data={perVariable?.ecdf ?? null} theme={theme} />
              <PlotCard data={perVariable?.cumulative ?? null} theme={theme} />
              <PlotCard data={perVariable?.runningRhat ?? null} theme={theme} />
              <PlotCard data={perVariable?.violin ?? null} theme={theme} />
              <PlotCard data={perVariable?.intervals ?? null} theme={theme} />
            </div>
          </>
        )}

        {active === "joint" && (
          <>
            <section className="block">
              <p className="eyebrow">Corner</p>
              <PlotCard data={corner} theme={theme} />
              {meta && meta.variables.length > CORNER_MAX_VARS && (
                <p className="tagline">
                  corner shows the first {CORNER_MAX_VARS} of {meta.variables.length} variables
                </p>
              )}
            </section>
            <section className="block">
              <p className="eyebrow">Scatterplot matrix</p>
              <PlotCard data={joint?.splom ?? null} theme={theme} />
            </section>
            <section className="block">
              <p className="eyebrow">Parallel coordinates</p>
              <PlotCard data={joint?.parallel ?? null} theme={theme} />
            </section>
          </>
        )}

        {active === "model" && (
          <>
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
          </>
        )}
      </main>
    </div>
  );
}
