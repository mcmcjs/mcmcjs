import type { LedgerEntry } from "@mcmcjs/core";
import { parseRunBundle } from "@mcmcjs/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Ambient, startAmbient } from "../lib/ambient";
import {
  type Endpoint,
  endpointFromPairing,
  fetchStores,
  ledgerUrl,
  linkedRunUrl,
  parseConnect,
  runUrl,
  toPairing,
} from "../lib/cli-server";
import { addRoot, getPairing, listRoots, putPairing, putRun } from "../lib/db";
import type { DeepLink } from "../lib/deeplink";
import { type BundleSource, classifyBundleUrl, fetchBundle } from "../lib/remote";
import { locateStore, readLedgerEntries, readStoreRun, timeAgo } from "../lib/runs";

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
  const [servedRuns, setServedRuns] = useState<LedgerEntry[] | null>(null);
  const [endpoint, setEndpoint] = useState<Endpoint | null>(null);
  const [reachable, setReachable] = useState<"unknown" | "probing" | "ok" | "unreachable">(
    "unknown",
  );
  const [storePath, setStorePath] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<"idle" | "pending" | "failed">(
    deepLink?.connect ? "pending" : "idle",
  );
  const [remote, setRemote] = useState<"idle" | "loading" | "failed">("idle");
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

  const bundleSource = useMemo(
    () => (deepLink?.bundle ? classifyBundleUrl(deepLink.bundle, window.location.href) : null),
    [deepLink],
  );

  const openRemoteBundle = useCallback(
    async (source: BundleSource, signal?: AbortSignal) => {
      setError(null);
      setRemote("loading");
      try {
        const bundle = await fetchBundle(source, signal);
        await putRun(bundle, source.origin);
        onOpen(bundle.entry.id);
      } catch (err) {
        if (signal?.aborted) return;
        setRemote("failed");
        setError((err as Error).message);
      }
    },
    [onOpen],
  );

  // A bundle published by a site we know opens on its own. One from anywhere
  // else waits for the reader, who is the only one who can say whether that
  // site is worth showing under mcmcjs chrome.
  useEffect(() => {
    if (!bundleSource?.trusted) return;
    const controller = new AbortController();
    void openRemoteBundle(bundleSource, controller.signal);
    return () => controller.abort();
  }, [bundleSource, openRemoteBundle]);

  // A CLI link carries the store server's port and token. Saving them is what
  // lets a later visit reconnect on its own, with no link and no file access.
  useEffect(() => {
    if (!deepLink?.connect) return;
    const parsed = parseConnect(deepLink.connect);
    if (!parsed) return;
    setEndpoint(parsed);
    if (!parsed.legacy) void putPairing(toPairing(parsed));
  }, [deepLink]);

  // No link: fall back to the last pairing, so a reload or a bookmark still
  // finds the CLI.
  useEffect(() => {
    if (deepLink?.connect) return;
    let cancelled = false;
    getPairing().then((pairing) => {
      if (!cancelled && pairing) setEndpoint(endpointFromPairing(pairing));
    });
    return () => {
      cancelled = true;
    };
  }, [deepLink]);

  // The linked run opens itself; the browser may hold this first fetch while it
  // asks for local-network permission.
  useEffect(() => {
    if (!endpoint || !deepLink?.runId) return;
    const url = linkedRunUrl(endpoint, deepLink.runId);
    if (!url) return;
    let cancelled = false;
    setHandoff("pending");
    openBundleUrl(url).catch(() => {
      if (!cancelled) setHandoff("failed");
    });
    return () => {
      cancelled = true;
    };
  }, [endpoint, deepLink, openBundleUrl]);

  // Whatever the CLI is serving, listed without any file access. Retrying
  // replaces the endpoint object, which re-runs this.
  useEffect(() => {
    if (!endpoint) return;
    let cancelled = false;
    setReachable("probing");
    fetch(ledgerUrl(endpoint))
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error())))
      .then((entries: LedgerEntry[]) => {
        if (cancelled) return;
        setServedRuns(entries);
        setReachable("ok");
        return fetchStores(endpoint).then((stores) => {
          if (!cancelled) setStorePath(stores.find((s) => s.id === endpoint.storeId)?.path ?? null);
        });
      })
      .catch(() => {
        if (cancelled) return;
        setServedRuns(null);
        setReachable("unreachable");
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  const openServedRun = useCallback(
    async (entry: LedgerEntry) => {
      if (!endpoint) return;
      setError(null);
      try {
        await openBundleUrl(runUrl(endpoint, entry.id));
      } catch (err) {
        setServedRuns(null);
        setReachable("unreachable");
        setError((err as Error).message);
      }
    },
    [endpoint, openBundleUrl],
  );

  const openLinkedRun = useCallback(async () => {
    if (!endpoint || !deepLink?.runId) return;
    const url = linkedRunUrl(endpoint, deepLink.runId);
    if (!url) return;
    setError(null);
    setHandoff("pending");
    try {
      await openBundleUrl(url);
    } catch (err) {
      setHandoff("failed");
      setError((err as Error).message);
    }
  }, [endpoint, deepLink, openBundleUrl]);

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
    if (!deepLink?.storePath || !deepLink.runId) return;
    listRoots().then(async (roots) => {
      const store = await locateStore(roots, deepLink.storePath as string, false);
      if (store) await openRunFromStore(store, deepLink.runId as string).catch(() => {});
    });
  }, [deepLink, openRunFromStore]);

  const connectStore = useCallback(async () => {
    if (!deepLink?.runId) return;
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
        <span className="drop-copy">
          <strong>Drop a run bundle</strong>
          <span>or click to browse</span>
        </span>
      </button>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onPick} />

      <p className="demo-line">
        New here?{" "}
        <button type="button" className="link-btn" onClick={openDemo}>
          Open the demo run
        </button>
      </p>

      {deepLink?.bundle && !bundleSource && (
        <div className="banner" role="alert">
          <div>
            <div>That report link cannot be opened</div>
            <div className="hint">
              A linked bundle has to be an https URL. <code>{deepLink.bundle}</code> is not one.
            </div>
          </div>
        </div>
      )}

      {bundleSource && (
        <div className="banner">
          <div>
            <div>
              {bundleSource.trusted || remote !== "idle" ? "A run from " : "Open a run from "}
              <code>{bundleSource.origin}</code>
            </div>
            {bundleSource.trusted ? (
              remote === "loading" && <div className="hint">fetching the bundle</div>
            ) : (
              <div className="hint">
                That site is not mcmcjs. Its model code, data and variable names will be shown here
                as they are; nothing about them has been checked.
              </div>
            )}
          </div>
          {(remote === "failed" || (!bundleSource.trusted && remote === "idle")) && (
            <button type="button" className="btn" onClick={() => openRemoteBundle(bundleSource)}>
              {remote === "failed" ? "Retry" : "Open the run"}
            </button>
          )}
        </div>
      )}

      {deepLink?.runId && (
        <div className="banner">
          <div>
            <div>
              Opening <code>{deepLink.runId}</code>
            </div>
            {handoff === "pending" ? (
              <div className="hint">
                If the browser asks to allow local network access, allow it.
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
          {endpoint ? (
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

      {endpoint && reachable === "unreachable" && (
        <div className="banner" role="alert">
          <div>
            <div>Cannot reach the mcmc store server</div>
            <div className="hint">
              Start it with <code>mcmc report</code>, and allow local network access if the browser
              asks. A run fitted on another machine needs <code>mcmc export bundle</code> instead,
              dropped here.
            </div>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => setEndpoint((current) => (current ? { ...current } : current))}
          >
            Retry
          </button>
        </div>
      )}

      {servedRuns && (
        <section className="block">
          <p className="eyebrow">Runs from the CLI</p>
          {storePath && <p className="hint">{storePath}</p>}
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
