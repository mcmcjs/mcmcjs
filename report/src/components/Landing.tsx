import type { LedgerEntry } from "@mcmcjs/core";
import { parseRunBundle } from "@mcmcjs/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Ambient, startAmbient } from "../lib/ambient";
import { addRoot, listRoots, putRun } from "../lib/db";
import { locateStore, readLedgerEntries, readStoreRun, timeAgo } from "../lib/runs";

export interface DeepLink {
  runId: string;
  storePath?: string;
  connect?: string;
}

function VerdictDot({ entry }: { entry: LedgerEntry }) {
  if (entry.status !== "ok") return <span className="dot bad" title={entry.status} />;
  const d = entry.diagnostics;
  if (!d) return <span className="dot na" title="no diagnostics" />;
  return (
    <span
      className={`dot ${d.converged ? "ok" : "bad"}`}
      title={d.converged ? "converged" : "not converged"}
    />
  );
}

export function Landing({
  deepLink,
  connect,
  onOpen,
  onToggleTheme,
  themeLabel,
}: {
  deepLink: DeepLink | null;
  connect?: string;
  onOpen: (id: string) => void;
  onToggleTheme: () => void;
  themeLabel: string;
}) {
  const [servedRuns, setServedRuns] = useState<LedgerEntry[] | null>(null);
  const [handoff, setHandoff] = useState<"idle" | "pending" | "failed">(
    deepLink?.connect ? "pending" : "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ambientRef = useRef<Ambient | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fsaSupported = "showDirectoryPicker" in window;

  const openBundleUrl = useCallback(
    async (url: string) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`the CLI server returned ${response.status}`);
      const bundle = parseRunBundle(await response.text());
      await putRun(bundle);
      onOpen(bundle.entry.id);
    },
    [onOpen],
  );

  // A freshly-run CLI serves the store on the loopback interface; fetching the
  // linked run opens it with no file access at all. The browser may hold the
  // first fetch on a local-network permission prompt.
  useEffect(() => {
    if (!deepLink?.connect) return;
    let cancelled = false;
    setHandoff("pending");
    openBundleUrl(deepLink.connect).catch(() => {
      if (!cancelled) setHandoff("failed");
    });
    return () => {
      cancelled = true;
    };
  }, [deepLink, openBundleUrl]);

  // While `mcmc report --watch` runs, the CLI serves the whole store; listing
  // it needs no file access and works in every browser.
  useEffect(() => {
    if (!connect) return;
    let cancelled = false;
    fetch(`${connect}/ledger`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error())))
      .then((entries: LedgerEntry[]) => {
        if (!cancelled) setServedRuns(entries);
      })
      .catch(() => {
        if (!cancelled) setServedRuns(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connect]);

  const openServedRun = useCallback(
    async (entry: LedgerEntry) => {
      setError(null);
      try {
        await openBundleUrl(`${connect}/run/${entry.id}`);
      } catch (err) {
        setServedRuns(null);
        setError(`${(err as Error).message}; the mcmc report server may have exited`);
      }
    },
    [connect, openBundleUrl],
  );

  const openLinkedRun = useCallback(async () => {
    if (!deepLink?.connect) return;
    setError(null);
    setHandoff("pending");
    try {
      await openBundleUrl(deepLink.connect);
    } catch (err) {
      setHandoff("failed");
      setError(`${(err as Error).message}; the mcmc report server may have exited`);
    }
  }, [deepLink, openBundleUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement as HTMLElement;
    canvas.width = parent.clientWidth * devicePixelRatio;
    canvas.height = parent.clientHeight * devicePixelRatio;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ambientRef.current = startAmbient(canvas, reduced);
    return () => ambientRef.current?.destroy();
  }, []);

  useEffect(() => {
    ambientRef.current?.setExcited(over);
  }, [over]);

  const importBundle = useCallback(
    async (text: string) => {
      try {
        const bundle = parseRunBundle(text);
        await putRun(bundle);
        onOpen(bundle.entry.id);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [onOpen],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setOver(false);
      const file = event.dataTransfer.files[0];
      if (file) file.text().then(importBundle);
    },
    [importBundle],
  );

  const onPick = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) file.text().then(importBundle);
      event.target.value = "";
    },
    [importBundle],
  );

  // The native file picker can start inside a granted folder, so bundles
  // sitting next to the store are one click away.
  const browseBundle = useCallback(async () => {
    if (!("showOpenFilePicker" in window)) {
      fileRef.current?.click();
      return;
    }
    try {
      const roots = await listRoots();
      const [picked] = await window.showOpenFilePicker({
        id: "mcmc-bundle",
        types: [{ description: "Run bundle", accept: { "application/json": [".json"] } }],
        ...(roots[0] ? { startIn: roots[0] } : {}),
      });
      if (picked) await importBundle(await (await picked.getFile()).text());
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    }
  }, [importBundle]);

  const openDemo = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}demo.mcmcrun.json`);
      if (!response.ok) throw new Error("the demo bundle could not be loaded");
      await importBundle(await response.text());
    } catch (err) {
      setError((err as Error).message);
    }
  }, [importBundle]);

  const openRunFromStore = useCallback(
    async (store: FileSystemDirectoryHandle, runId: string) => {
      const entries = await readLedgerEntries(store);
      const entry = entries.find((e) => e.id.startsWith(runId));
      if (!entry) throw new Error(`run ${runId} is not in this store`);
      const bundle = await readStoreRun(store, entry);
      await putRun(bundle);
      onOpen(entry.id);
    },
    [onOpen],
  );

  // A deep link resolves silently when a granted folder already reaches it.
  useEffect(() => {
    if (!deepLink?.storePath) return;
    listRoots().then(async (roots) => {
      const store = await locateStore(roots, deepLink.storePath as string, false);
      if (store) await openRunFromStore(store, deepLink.runId).catch(() => {});
    });
  }, [deepLink, openRunFromStore]);

  const connectStore = useCallback(async () => {
    if (!deepLink) return;
    setError(null);
    try {
      if (deepLink.storePath) {
        const roots = await listRoots();
        const located = await locateStore(roots, deepLink.storePath, true);
        if (located) {
          await openRunFromStore(located, deepLink.runId);
          return;
        }
      }
      const handle = await window.showDirectoryPicker({ id: "mcmc-store", mode: "read" });
      await addRoot(handle);
      const store = deepLink.storePath
        ? await locateStore([handle], deepLink.storePath, false)
        : handle;
      if (store) {
        await openRunFromStore(store, deepLink.runId);
        return;
      }
      setError(
        `"${handle.name}" does not contain that store; pick the .mcmc folder or one above it`,
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    }
  }, [deepLink, openRunFromStore]);

  return (
    <div className="shell">
      <div className="topline">
        <div>
          <h1 className="wordmark">
            mcmc <span className="dim">report</span>
          </h1>
          <p className="tagline">Explore finished runs. Everything stays on this machine.</p>
        </div>
        <button type="button" className="icon-btn" onClick={onToggleTheme}>
          {themeLabel}
        </button>
      </div>

      <button
        type="button"
        className={`drop-frame${over ? " over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        onClick={browseBundle}
        aria-label="Drop or choose a run bundle"
      >
        <canvas ref={canvasRef} />
        <span className="axes" />
        <span className="drop-copy">
          <strong>Drop a run bundle</strong>
          <span>mcmc export bundle · or click to browse</span>
        </span>
      </button>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onPick} />

      <p className="demo-line">
        New here?{" "}
        <button type="button" className="link-btn" onClick={openDemo}>
          Open the demo run
        </button>{" "}
        to see a full report.
      </p>

      {deepLink && (
        <div className="banner">
          <div>
            <div>
              Run <code>{deepLink.runId}</code> was opened from the CLI.
            </div>
            {handoff === "pending" ? (
              <div className="hint">
                opening it from the CLI... if the browser asks to allow local network access, allow
                it
              </div>
            ) : (
              deepLink.storePath && (
                <div className="hint">
                  store: {deepLink.storePath}{" "}
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => navigator.clipboard.writeText(deepLink.storePath as string)}
                  >
                    copy
                  </button>
                </div>
              )
            )}
          </div>
          {deepLink.connect ? (
            <button type="button" className="btn" onClick={openLinkedRun}>
              Open run
            </button>
          ) : fsaSupported ? (
            <button type="button" className="btn" onClick={connectStore}>
              Connect store
            </button>
          ) : (
            <span className="hint">drop its bundle here to open it</span>
          )}
        </div>
      )}

      {error && (
        <div className="banner" role="alert">
          <div>{error}</div>
        </div>
      )}

      {servedRuns && (
        <section className="block">
          <p className="eyebrow">Run store · served by the CLI</p>
          <table className="ledger">
            <thead>
              <tr>
                <th>run</th>
                <th>model</th>
                <th>backend</th>
                <th>when</th>
                <th aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {servedRuns.map((entry) => (
                <tr key={entry.id} className="row" onClick={() => openServedRun(entry)}>
                  <td>
                    <VerdictDot entry={entry} />
                    {entry.id.slice(0, 15)}
                  </td>
                  <td>{(entry.model_path.split("/").pop() ?? "").replace(/\.[^.]+$/, "")}</td>
                  <td>{entry.backend.id}</td>
                  <td>{timeAgo(entry.started_at)}</td>
                  <td>
                    <button type="button" className="icon-btn">
                      open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
