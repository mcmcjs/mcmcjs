import { parseRunBundle, type RunBundle } from "@mcmcjs/core";

/**
 * Sites that publish mcmcjs reports as part of their own documentation. A
 * bundle from one of these opens straight away; a bundle from anywhere else is
 * fetched only after the reader has agreed to it, because the page around it is
 * first-party mcmcjs and the run inside it is not.
 */
export const TRUSTED_ORIGINS = ["https://turinglang.org", "https://turinglang.github.io"];

/** Past this a bundle is refused rather than left to fill the tab's memory. */
export const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;

export interface BundleSource {
  url: string;
  origin: string;
  trusted: boolean;
}

function isLoopback(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
}

/**
 * Resolves a bundle URL from the hash and decides whether it may be opened
 * without asking. Returns null for anything that is not a fetchable https URL,
 * so a `javascript:` or `data:` hash never reaches the network layer at all.
 * Trust is judged on the parsed origin, never on the text of the link.
 */
export function classifyBundleUrl(raw: string, base: string): BundleSource | null {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  const loopback = isLoopback(url);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
  const trusted =
    loopback || url.origin === new URL(base).origin || TRUSTED_ORIGINS.includes(url.origin);
  return { url: url.href, origin: url.origin, trusted };
}

function tooBig(): Error {
  return new Error(`that bundle is larger than ${MAX_BUNDLE_BYTES / (1024 * 1024)} MB`);
}

/** Reads the body, giving up rather than buffering an unbounded response. */
async function readCapped(response: Response): Promise<string> {
  const body = response.body;
  if (!body) {
    const text = await response.text();
    if (text.length > MAX_BUNDLE_BYTES) throw tooBig();
    return text;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let seen = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value.byteLength;
    if (seen > MAX_BUNDLE_BYTES) {
      await reader.cancel();
      throw tooBig();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * Fetches a bundle the reader has accepted. No credentials are attached, and a
 * redirect off the agreed origin is refused so an open redirect on a trusted
 * site cannot stand in for one.
 */
export async function fetchBundle(source: BundleSource, signal?: AbortSignal): Promise<RunBundle> {
  const response = await fetch(source.url, { credentials: "omit", signal });
  if (!response.ok) throw new Error(`${source.origin} returned ${response.status}`);
  const landed = response.url ? new URL(response.url).origin : source.origin;
  if (landed !== source.origin) throw new Error(`that link redirected to ${landed}`);
  if (Number(response.headers.get("content-length")) > MAX_BUNDLE_BYTES) throw tooBig();
  return parseRunBundle(await readCapped(response));
}
