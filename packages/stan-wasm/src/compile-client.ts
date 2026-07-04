import type { CompileResult } from "./types";

export interface CompileRequest {
  serverUrl: string;
  passcode?: string;
  stanCode: string;
  signal?: AbortSignal;
}

const trimTrailingSlash = (url: string): string => url.replace(/\/+$/, "");

export async function compileStanCode(req: CompileRequest): Promise<CompileResult> {
  const base = trimTrailingSlash(req.serverUrl);
  const headers: Record<string, string> = { "Content-Type": "text/plain" };
  if (req.passcode) {
    headers.Authorization = `Bearer ${req.passcode}`;
  }
  const res = await fetch(`${base}/compile`, {
    method: "POST",
    headers,
    body: req.stanCode,
    signal: req.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Stan WASM compile failed (HTTP ${res.status}): ${text || res.statusText}`);
  }
  const json = (await res.json()) as { model_id?: unknown; main_js_url?: unknown };
  if (typeof json.model_id !== "string" || json.model_id.length === 0) {
    throw new Error("Stan WASM compile response did not include a model_id");
  }
  const mainJsUrl =
    typeof json.main_js_url === "string" && json.main_js_url.length > 0
      ? json.main_js_url
      : `${base}/download/${json.model_id}/main.js`;
  return {
    modelId: json.model_id,
    mainJsUrl,
  };
}

export async function probeServer(opts: { serverUrl: string }): Promise<boolean> {
  const base = trimTrailingSlash(opts.serverUrl);
  try {
    const res = await fetch(`${base}/probe`, { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}
