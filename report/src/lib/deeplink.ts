/**
 * What a link into the app can name. `run` alone opens a run this browser has
 * already seen; `store` and `connect` say where the CLI keeps it; `bundle` is a
 * URL to a self-contained bundle, which is what lets a page elsewhere on the
 * web link straight to a rendered report.
 */
export interface DeepLink {
  runId?: string;
  storePath?: string;
  connect?: string;
  bundle?: string;
}

export function parseHash(hash: string): DeepLink | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const runId = params.get("run");
  const bundle = params.get("bundle");
  if (!runId && !bundle) return null;
  return {
    runId: runId ?? undefined,
    storePath: params.get("store") ?? undefined,
    connect: params.get("connect") ?? undefined,
    bundle: bundle ?? undefined,
  };
}

/**
 * The hash to show once a run is open. A bundle URL is carried over so the
 * address bar keeps a link that still works in a browser that has never seen
 * this run; the store and connect parts are one-shot and are dropped.
 */
export function runHash(runId: string, link: DeepLink | null): string {
  const params = new URLSearchParams({ run: runId });
  if (link?.bundle) params.set("bundle", link.bundle);
  return params.toString();
}
