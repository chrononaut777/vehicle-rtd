# Satisfactory Vehicle Round-Trip Planner (vehicle-rtd)

Unofficial browser app for planning **train** and **drone** routes on the Satisfactory world map and estimating **round-trip duration**, including multi-route maps, flat-track mode, and grade-aware train physics.

**Not affiliated with Coffee Stain Studios.**

Live site (GitHub Pages): https://chrononaut777.github.io/vehicle-rtd/

## Features

- SCIM basemap (realistic / game map) with resource-node overlays
- Multiple named routes (train or drone) on one shared station/port map
- Link stops, waypoints, drag midpoints; RT HUD and issue coloring
- Flat track mode, consist / drone fleet sizing from station I/O
- Local-only persistence (IndexedDB) + JSON export/import + shareable URL hash

## Quick start

```bash
npm install
npm run build:heightmap
npm run build:nodes
npm run dev
```

Open the printed local URL. Data stays in your browser unless you export JSON or copy a share link.

## Deploy (GitHub Pages)

Pushes to `main` run [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml): test, build with `base: /vehicle-rtd/`, and publish to GitHub Pages.

One-time setup on the GitHub repo:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**
2. Ensure Actions are allowed for the repo

Local production build for Pages:

```bash
set GITHUB_PAGES=true
npm run build
```

(On Unix: `GITHUB_PAGES=true npm run build`.) Preview with any static server of `dist/`, remembering assets live under `/vehicle-rtd/`.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Production build |
| `npm run test` | Physics unit tests |
| `npm run build:tiles` | Generate `public/tiles/basemap.webp` (+ zoom pyramid) |
| `npm run build:heightmap` | Generate `public/data/heightmap.*` placeholder DEM |
| `npm run build:nodes` | Extract SCIM resource nodes/wells → `public/data/resource-nodes.json` |

## Assets / attribution

**Basemap tiles** are hotlinked at runtime from the [Satisfactory-Calculator Interactive Map (SCIM)](https://satisfactory-calculator.com/interactive-map) CDN (`imgMap/gameLayer/Stable/...`). They are **not** redistributed in this repo. SCIM’s own license forbids forking/redeploying their app; tile hotlinking depends on their CDN and may break if URLs or referrer rules change.

The page uses `referrer: no-referrer` because the CDN returns **403** when the `Referer` is `localhost`.

**Heightmap** under `public/data/` is a coarse procedural DEM for grade/clearance hints only (approximate).

**Resource nodes** are a compact local extract of SCIM `mapData` (`npm run build:nodes`). The live SCIM JSON is CORS-blocked from other origins, so the app does not fetch it at runtime. Node overlay is off by default and lazy-loads when enabled.

Coordinates in the UI use in-game **meters** (wiki world bounds ≈ X −3246…4253, Y −3750…3750). Projection matches SCIM’s `CRS.Simple` raster mapping (internal cm).

## Physics notes

Defaults follow the Satisfactory wiki (Electric Locomotive / Freight Car / Train Station):

- Docking dwell ≈ 27.08 s when cargo transfer is assumed (overridable per station)
- Max speed 120 km/h on flat; 2000 kN per locomotive; masses and resistances as documented on the wiki
- Flat mode forces grade = 0; terrain clipping warnings still use the heightmap

Estimates are planning aids — in-game pathing, signals, and exact track geometry will differ.
