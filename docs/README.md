# MCMC.js docs

The documentation site for MCMC.js, built with a hand-rolled Astro theme (no Starlight).

This project is standalone: it is not part of the pnpm workspace and is installed and built on its own with npm.

## Commands

All commands run from `docs/`:

| Command            | Action                                               |
| :----------------- | :--------------------------------------------------- |
| `npm install`      | Install dependencies                                 |
| `npm run dev`      | Start the local dev server (search is disabled here) |
| `npm run build`    | Build to `dist/` and index it with Pagefind          |
| `npm run preview`  | Preview the production build locally                 |
| `npm run typecheck`| Type-check with `tsc --noEmit`                       |
| `npm run check`    | Lint and format check with Biome                     |
| `npm run format`   | Format with Biome                                    |

The `base` path is overridable via the `BASE_PATH` environment variable for
subpath deployments.

## Layout

```text
src/
  components/   Logo, Search, TableOfContents, icons
  data/         navigation groups and quick links
  layouts/      BaseLayout, DocsLayout
  lib/          withBase path helper
  pages/        landing page, docs/, og.png, robots.txt, 404
  styles/       global.css design system (paper theme)
  utils/        Satori + resvg OG image generator
```
