---
group: Guides
title: Workers, packaging and deployment
---

# Workers, packaging and deployment

## Browser assets

The default engine lazily creates an ES module worker relative to its installed module. Vite consumers should use `worker: { format: "es" }` in their Vite configuration. The worker is bundled in `@georeferencing/core`; no WASM binary, CDN, SharedArrayBuffer or cross-origin isolation is required.

The worker script is exported as `@georeferencing/core/worker`, so bundlers can emit it directly; with Vite, `import ProcessingWorker from "@georeferencing/core/worker?worker"` and pass `workerFactory: () => new ProcessingWorker()`. For explicit asset placement, copy the installed `dist/engine/worker.js` to a same-origin URL and pass that URL as `workerUrl`. Preserve its linked license notice beside it and retain the package license inventory in your distribution. Alternatively supply `workerFactory: () => new Worker(url, { type: "module" })`. Each returned worker belongs to one operation and is terminated afterwards; do not return a worker shared with unrelated application work.

Use a URL that includes your deployment base path. Your CSP must permit the worker, local blob image previews, and your configured reference/persistence destinations. The package has no default image upload or telemetry. The repository's clean-consumer check exercises a packed installation with a non-root base path and same-origin worker CSP.

Construction and module imports are SSR-safe. Actual processing requires browser File/Blob, module Worker, OffscreenCanvas and supported decoders. Deflate output requires CompressionStream. UUID generation uses Web Crypto in a secure browser context. Create maps and start browser work from client lifecycle code.

## Encoder assets

The `geoTiff()` and `jpeg()` plugin factories lazily start their own bundled codec workers after the core engine renders the raster. They use the same engine limits, projections, datum grids, scheduling and abort signal. Temporary RGBA buffers are transferred to the codec worker and returned with the encoded Blob; preview buffers are never transferred. There is no duplicate input decoder in these workers.

Defaults work relative to the installed plugin module. For explicit placement, copy `@georeferencing/plugins/dist/workers/geotiff.js` or `jpeg.js` and its adjacent license notice, then configure `geoTiff({ workerUrl: "/assets/geotiff.js" })` or `jpeg({ workerUrl: "/assets/jpeg.js" })`. Each factory also accepts a `workerFactory`. Bundler imports such as `@georeferencing/plugins/geotiff-worker?worker` are supported by Vite. Distribute the package's `dist/licenses` inventory with copied assets.

PDF has no codec worker: report and pdf-lib modules load on demand. Aborting prevents delivery of a late report but does not interrupt synchronous PDF work. Module downloads may finish after cancellation.

## Budgets and cancellation

| Default | Limit |
| --- | ---: |
| Compressed file size | 26,214,400 bytes (25 MiB) |
| Input pixels | 24,000,000 |
| Output pixels | 24,000,000 |
| Estimated processing memory | 768 MiB |
| Longest preview dimension | 768 pixels |
| Enabled GCPs | 128 |

Compressed size does not bound decoded memory. Header inspection rejects unsupported layouts and checks dimensions before decoding; processing reserves a conservative estimate for input/output/encoding copies. These limits are a supported envelope, not a promise of browser heap availability. Raising them requires host-specific measurements.

Preview decodes are reduced; original bytes remain available for final export. Output uses bounded strips during encoding, but full source/output rasters still exist in memory. Large nonlinear warps are not an out-of-core raster system.

Each operation has its own worker. Abort terminates that worker or removes queued work before allocation. `createJobScheduler(1)` can be shared across engines to bound total concurrent workers; pass it as the `scheduler` option. Do not acquire a scheduler slot manually around an engine already using that scheduler.

## Package contents

Each package ships ESM, TypeScript declarations with the full API documentation, and third-party notices under `dist/licenses`. CSS ships only with `@georeferencing/react`, encoder workers with `@georeferencing/plugins`, and input processing with `@georeferencing/core`. Install the same version of all three packages; see [keep package versions aligned](./getting-started.md#keep-package-versions-aligned).

Production worker assets are minified without source maps to keep packages small. PDF's optional map contract is structural, so a headless
plugins consumer needs no OpenLayers installation.

To build the packages, documentation or demo from source, see the [repository README](https://github.com/tobilg/georeferencing#development).
