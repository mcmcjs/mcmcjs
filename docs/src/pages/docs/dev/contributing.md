---
layout: ../../../layouts/DocsLayout.astro
title: Contributing
description: The workspace, the toolchain scripts, and the project conventions.
---

MCMC.js is a pnpm workspace monorepo.
This page covers how to work in it.

## The workspace

Packages live under `packages/` (see [Packages](/docs/dev/packages/)).
Install everything once from the repo root:

```bash
pnpm install
```

The common scripts run across the whole workspace:

```bash
pnpm build      # tsup build (all packages)
pnpm test       # vitest run
pnpm typecheck  # tsc --noEmit
pnpm check      # biome check (lint + format)
```

The stack is TypeScript (ESM-first, dual ESM+CJS via [tsup](https://tsup.egoist.dev)), Node >= 22, [Vitest](https://vitest.dev) for tests, [Biome](https://biomejs.dev) for lint and format, and [Changesets](https://github.com/changesets/changesets) for versioning.

## Tests

Tests live in a per-package `test/` directory, a sibling of `src/` mirroring its subdirectories, never inside `src/`.
They import the code under test via relative `../src/<module>` paths (a package self-reference would resolve to a stale `dist/`).
Write separate, focused, meaningful tests for each part; aggressively but sensibly, no filler.

## Changesets

Add a changeset for each change; do not hand-edit version numbers.

```bash
pnpm changeset
```

Prefer one changeset per package, each with a package-specific, single-line summary (it becomes a changelog entry).
Use a single multi-package changeset only for a genuinely cross-cutting change.
Versioning is independent per package, starting at `0.x`; releases publish through CI when the release PR merges.

## Commit and code conventions

- One concise commit line, casual tone, no prefixes (no `feat:` / `fix:`), no emojis, no trailers. Commit iteratively, one logical change per commit.
- Professional, senior-engineer quality; match the surrounding code. TypeScript strict; clear, typed, composable code.
- Minimal comments; comment only where it adds real value. Use `TODO` for genuine pending work.
- Plain text: write `->` rather than an arrow glyph, use em dashes sparingly, and keep meaningful mathematical and scientific notation in math and diagnostics source.

## Publishing

Publishable packages ship build artifacts only (`dist/` plus type declarations), controlled by each package's `files` allowlist, never source, tests, or configs.
Verify with `npm publish --dry-run` before publishing.
Every publishable package carries its own `LICENSE` (MIT).

## The docs site

This documentation site lives in `docs/`, an [Astro](https://astro.build) project that is standalone and not part of the pnpm workspace.
It has its own scripts:

```bash
cd docs
npm run dev        # local dev server
npm run build      # astro build + pagefind search index
npm run typecheck  # tsc --noEmit
npm run check      # biome check
```

Pages are Markdown under `src/pages/docs/`, one file per route; the sidebar is defined in `src/data/navigation.ts`.
