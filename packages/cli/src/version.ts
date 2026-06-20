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
 * description, copyright/license, and the homepage.
 */
export function versionText(version: string, meta: VersionMeta): string {
  const author = meta.authorUrl ? `${meta.authorName} <${meta.authorUrl}>` : meta.authorName;
  return [
    `mcmc (mcmcjs) ${version}`,
    meta.description,
    `Copyright © ${meta.year} ${author}. ${meta.license} license.`,
    meta.homepage,
  ].join("\n");
}
