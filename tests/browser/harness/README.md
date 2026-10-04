# Browser test harnesses

These development pages exercise the public package exports using actual browser
files, workers and OpenLayers maps. They are separate from the Hamburg demo and
are neither published to npm nor included in the demo's production build.

## Run locally

From the workspace root, with Node.js 22.12+ and pnpm 12.x:

```sh
pnpm install --frozen-lockfile
pnpm build:packages
pnpm dev:harness
```

The harness server listens on `http://127.0.0.1:5174`. Open one of the pages below;
there is no application at `/`. To change the port, use
`pnpm dev:harness --port 5199`. The server serves built package exports; rebuild
the affected package after changing library code, or run its development watcher.

| Page | Purpose | Browser handles |
| --- | --- | --- |
| `/validation.html` | Two independent React Strict Mode editors, borrowed host layers, projection/reference checks, drawing and saving | `window.validation` |
| `/validation.html?editors=1` | Single editor with normal Save/Discard/Cancel guards for complete workflow and export tests | `window.validation` |
| `/engine.html` | File inspection, fitting, preview and real GeoTIFF encoding in workers | `window.engine`, `window.runEngine`, `window.encodeRaster` |

The engine page accepts a local image. Its synthetic control points exercise the
processing path; they do not establish an unknown image's geographic position.
Browser handles are internal test interfaces, not supported package exports.

`validation.tsx` imports `tests/fixtures/grid.png` as a Vite asset and exposes its
URL as `window.validation.gridUrl`. Tests and benchmarks share that canonical
fixture. `exports.ts` enables every export format for integration checks without
depending on the demo's plugin configuration. WFS responses and host saving are
test adapters; no live WFS/database is written.

## Automated regression tests

```sh
pnpm exec playwright install  # only if browser binaries are missing
pnpm test:browser
```

Playwright builds the packages and starts two servers: the Hamburg demo on port
5173 and this harness on port 5174. Only `guided.spec.ts` targets the demo; the
remaining browser specs target these harness pages. Guided tests replace OSM tile
requests with deterministic fixtures. Both servers are shut down after the run
unless Playwright reused servers that were already running.

Use free ports when running alongside development servers:

```sh
PLAYWRIGHT_PORT=5198 HARNESS_PORT=5199 pnpm test:browser
```

`HARNESS_PORT` defaults to `PLAYWRIGHT_PORT + 1`. Root `pnpm typecheck` and
`pnpm lint` cover the harness source and configuration alongside the tests.

## Independent raster checks and benchmarks

With `pnpm dev:harness` running in another terminal:

```sh
node tests/reference/engine-check.mjs
node benchmarks/benchmark.mjs
node benchmarks/benchmark-all.mjs
```

`engine-check.mjs` requires native `gdalinfo`. It checks affine, Polynomial 2 and
TPS preview/export agreement and independently reads GeoTIFF metadata and pixel
checksums, including Deflate output. It writes rasters to ignored `artifacts/`
and a local report to ignored `artifacts/reports/engine.json`. Downstream native raster
checks retain the same artifact filenames.

The benchmark scripts measure processing, cancellation and resource cleanup;
`benchmark-all.mjs` additionally samples process memory and accepts
`--browser=chromium`, `--browser=firefox` or `--browser=webkit`. Their reports stay
under ignored `artifacts/reports/`. These measurements are not QGIS parity fixtures;
independent reference data and regeneration prerequisites are described in
[`tests/fixtures/README.md`](../../fixtures/README.md).

Scripts default to port 5174. Point them at a custom harness server with:

```sh
HARNESS_URL=http://127.0.0.1:5199 node tests/reference/engine-check.mjs
```

The same `HARNESS_URL` override applies to both benchmark scripts. It does not
start a server; `HARNESS_PORT` only configures Playwright's managed server.
