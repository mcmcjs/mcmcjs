import type { Pairing } from "./db";

/**
 * How the app talks to the CLI's store server. Two shapes exist: the current
 * one, `/v1/<token>/stores/<storeId>`, which the app can rebuild from a saved
 * pairing, and the pre-pairing one, `/<token>`, still emitted by older CLIs.
 */
export interface Endpoint {
  /** Daemon root, e.g. http://127.0.0.1:7788. */
  origin: string;
  token: string;
  storeId?: string;
  legacy: boolean;
}

export function parseConnect(connect: string): Endpoint | undefined {
  let url: URL;
  try {
    url = new URL(connect);
  } catch {
    return undefined;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "v1" && parts[1] && parts[2] === "stores" && parts[3]) {
    return { origin: url.origin, token: parts[1], storeId: parts[3], legacy: false };
  }
  if (parts.length === 1 && parts[0]) {
    return { origin: url.origin, token: parts[0], legacy: true };
  }
  return undefined;
}

export function endpointFromPairing(pairing: Pairing, storeId?: string): Endpoint {
  return {
    origin: pairing.origin,
    token: pairing.token,
    storeId: storeId ?? pairing.storeId,
    legacy: false,
  };
}

export function toPairing(endpoint: Endpoint): Pairing {
  return { origin: endpoint.origin, token: endpoint.token, storeId: endpoint.storeId };
}

function storeBase(endpoint: Endpoint): string {
  return `${endpoint.origin}/v1/${endpoint.token}/stores/${endpoint.storeId ?? ""}`;
}

export function storesUrl(endpoint: Endpoint): string {
  return `${endpoint.origin}/v1/${endpoint.token}/stores`;
}

export function ledgerUrl(endpoint: Endpoint): string {
  return endpoint.legacy
    ? `${endpoint.origin}/${endpoint.token}/ledger`
    : `${storeBase(endpoint)}/ledger`;
}

export function runUrl(endpoint: Endpoint, runId: string): string {
  return endpoint.legacy
    ? `${endpoint.origin}/${endpoint.token}/run/${runId}`
    : `${storeBase(endpoint)}/runs/${runId}`;
}

/** The run an old-style link points at is served from the link itself. */
export function linkedRunUrl(endpoint: Endpoint, runId?: string): string | undefined {
  if (endpoint.legacy) return `${endpoint.origin}/${endpoint.token}`;
  return runId ? runUrl(endpoint, runId) : undefined;
}

export interface StoreListing {
  id: string;
  path: string;
  runs: number;
}

/** Short so a dead port fails fast instead of hanging the landing page. */
const PROBE_TIMEOUT_MS = 4_000;

export async function fetchStores(endpoint: Endpoint): Promise<StoreListing[]> {
  const response = await fetch(storesUrl(endpoint), {
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`the CLI server returned ${response.status}`);
  return (await response.json()) as StoreListing[];
}
