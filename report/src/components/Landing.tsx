import type { LedgerEntry } from "@mcmcjs/core";
import { parseRunBundle } from "@mcmcjs/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Ambient, startAmbient } from "../lib/ambient";
import {
  addRoot,
  deleteRun,
  getStoreHandle,
  listRoots,
  listRuns,
  putRun,
  type StoredRun,
  setStoreHandle,
} from "../lib/db";
import {
  bundleTitle,
  downloadBundle,
  ensurePermission,
  locateStore,
  readLedgerEntries,
  readStoreRun,
  timeAgo,
  verifyStoreHandle,
} from "../lib/runs";

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
  onOpen,
  onToggleTheme,
  themeLabel,
}: {
  deepLink: DeepLink | null;
  onOpen: (id: string) => void;
  onToggleTheme: () => void;
  themeLabel: string;
}) {
  const [library, setLibrary] = useState<StoredRun[]>([]);
  const [storeRuns, setStoreRuns] = useState<LedgerEntry[] | null>(null);
  const [storeName, setStoreName] = useState<string | null>(null);
  const [needsGrant, setNeedsGrant] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ambientRef = useRef<Ambient | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fsaSupported = "showDirectoryPicker" in window;

  const refreshLibrary = useCallback(() => {
    listRuns().then(setLibrary, () => setLibrary([]));
  }, []);

  const listConnectedStore = useCallback(async (handle: FileSystemDirectoryHandle) => {
    setStoreName(handle.name);
    setStoreRuns(await readLedgerEntries(handle));
    setNeedsGrant(false);
  }, []);

  const openRunFromStore = useCallback(
    async (store: FileSystemDirectoryHandle, runId: string) => {
      const entries = await readLedgerEntries(store);
      const entry = entries.find((e) => e.id.startsWith(runId));
      if (!entry) throw new Error(`run ${runId} is not in this store`);
      const bundle = await readStoreRun(store, entry);
      await putRun(bundle);
      await setStoreHandle(store);
      onOpen(entry.id);
    },
    [onOpen],
  );

  useEffect(() => {
    refreshLibrary();
    getStoreHandle().then(async (handle) => {
      if (!handle) return;
      setStoreName(handle.name);
      if (await ensurePermission(handle, false)) await listConnectedStore(handle);
      else setNeedsGrant(true);
    });
  }, [refreshLibrary, listConnectedStore]);

  // A freshly-run CLI serves the bundle on the loopback interface; fetching it
  // opens the run with no file access at all.
  useEffect(() => {
    if (!deepLink?.connect) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(deepLink.connect as string);
        if (!response.ok) throw new Error(`handoff returned ${response.status}`);
        const bundle = parseRunBundle(await response.text());
        if (cancelled) return;
        await putRun(bundle);
        onOpen(bundle.entry.id);
      } catch {
        // The one-shot server is gone; the store and bundle paths still work.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deepLink, onOpen]);

  // A deep link resolves silently when a granted folder already reaches it.
  useEffect(() => {
    if (!deepLink?.storePath) return;
    listRoots().then(async (roots) => {
      const store = await locateStore(roots, deepLink.storePath as string, false);
      if (store) await openRunFromStore(store, deepLink.runId).catch(() => {});
    });
  }, [deepLink, openRunFromStore]);

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

  const connectStore = useCallback(async () => {
    setError(null);
    try {
      if (deepLink?.storePath) {
        const roots = await listRoots();
        const located = await locateStore(roots, deepLink.storePath, true);
        if (located) {
          await openRunFromStore(located, deepLink.runId);
          return;
        }
      }
      const existing = await getStoreHandle();
      if (!deepLink && existing && (await ensurePermission(existing, true))) {
        await listConnectedStore(existing);
        return;
      }
      const roots = await listRoots();
      const handle = await window.showDirectoryPicker({
        id: "mcmc-store",
        mode: "read",
        ...(roots[0] ? { startIn: roots[0] } : {}),
      });
      await addRoot(handle);
      if (await verifyStoreHandle(handle)) {
        await setStoreHandle(handle);
        await listConnectedStore(handle);
        if (deepLink) await openRunFromStore(handle, deepLink.runId);
        return;
      }
      if (deepLink?.storePath) {
        const store = await locateStore([handle], deepLink.storePath, false);
        if (store) {
          await listConnectedStore(store);
          await openRunFromStore(store, deepLink.runId);
          return;
        }
        setError(
          `"${handle.name}" does not contain that store; pick the .mcmc folder or one above it`,
        );
        return;
      }
      setError(`"${handle.name}" has no index.json; pick the .mcmc store folder or one above it`);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    }
  }, [deepLink, listConnectedStore, openRunFromStore]);

  const openFromStore = useCallback(
    async (entry: LedgerEntry) => {
      setError(null);
      try {
        const handle = await getStoreHandle();
        if (!handle || !(await ensurePermission(handle, true))) return;
        const bundle = await readStoreRun(handle, entry);
        await putRun(bundle);
        onOpen(entry.id);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [onOpen],
  );

  const deepLinkEntry = deepLink && storeRuns?.find((e) => e.id.startsWith(deepLink.runId));
  const deepLinkInLibrary = deepLink && library.some((r) => r.id.startsWith(deepLink.runId));

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
        onClick={() => fileRef.current?.click()}
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

      {deepLink && !deepLinkInLibrary && (
        <div className="banner">
          <div>
            <div>
              Run <code>{deepLink.runId}</code> was opened from the CLI.
            </div>
            {deepLink.storePath && (
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
            )}
            <div className="hint">
              connect the store folder, or any folder above it to open future runs automatically
              (Ctrl+L pastes a path in the picker)
            </div>
          </div>
          {deepLinkEntry ? (
            <button type="button" className="btn" onClick={() => openFromStore(deepLinkEntry)}>
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

      <section className="block">
        <p className="eyebrow">In this browser</p>
        {library.length === 0 ? (
          <div className="empty">Reports you open are stored here, available offline.</div>
        ) : (
          <table className="ledger">
            <thead>
              <tr>
                <th>run</th>
                <th>model</th>
                <th>backend</th>
                <th>chains</th>
                <th>saved</th>
                <th aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {library.map((run) => (
                <tr key={run.id} className="row" onClick={() => onOpen(run.id)}>
                  <td>
                    <VerdictDot entry={run.bundle.entry} />
                    {run.id.slice(0, 15)}
                  </td>
                  <td>{bundleTitle(run.bundle)}</td>
                  <td>{run.bundle.entry.backend.id}</td>
                  <td>{run.bundle.entry.sampler.chains}</td>
                  <td>{timeAgo(new Date(run.savedAt).toISOString())}</td>
                  <td>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        downloadBundle(run.bundle);
                      }}
                    >
                      save
                    </button>{" "}
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteRun(run.id).then(refreshLibrary);
                      }}
                    >
                      delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {fsaSupported && (
        <section className="block">
          <p className="eyebrow">Run store on disk</p>
          {storeRuns === null ? (
            <div className="empty">
              {needsGrant && storeName ? (
                <button type="button" className="btn quiet" onClick={connectStore}>
                  Allow reading “{storeName}” again
                </button>
              ) : (
                <button type="button" className="btn quiet" onClick={connectStore}>
                  Connect your .mcmc store
                </button>
              )}
            </div>
          ) : (
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
                {storeRuns.map((entry) => (
                  <tr key={entry.id} className="row" onClick={() => openFromStore(entry)}>
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
          )}
        </section>
      )}
    </div>
  );
}
