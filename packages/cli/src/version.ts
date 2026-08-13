import { banner } from "./logo";

/** Build-time metadata injected by tsup (see tsup.config.ts `define`). */
export interface VersionMeta {
  description: string;
  authorName: string;
  authorUrl?: string;
  license: string;
  homepage: string;
  year: number;
}

/**
 * The multi-line `--version` text, GNU-style: the version on line 1 (so
 * `mcmc --version | head -1` stays machine-parseable), then a one-line
 * description, copyright/license, and the homepage. The wordmark is added
 * only for a person at a terminal, after the parseable line, so piping into
 * `head -1` or a script sees exactly what it always did.
 */
export function versionText(version: string, meta: VersionMeta, art = false): string {
  const author = meta.authorUrl ? `${meta.authorName} <${meta.authorUrl}>` : meta.authorName;
  return [
    `mcmc (mcmcjs) ${version}`,
    ...(art ? ["", banner(), ""] : []),
    meta.description,
    `Copyright © ${meta.year} ${author}. ${meta.license} license.`,
    meta.homepage,
  ].join("\n");
}
