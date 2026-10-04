---
group: Guides
title: Optional export plugins
---

# Optional export plugins

`@georeferencing/core` enables no export formats by default. Install `@georeferencing/plugins` for the formats you want, then pass descriptors in `ControllerOptions.exports`. `@georeferencing/react` reads that registry to display export actions. Alignment, confirmation, digitizing and host saving do not depend on any exporter.

```sh
pnpm add @georeferencing/core @georeferencing/plugins
# Add UI when needed:
pnpm add @georeferencing/react react@19 react-dom@19 ol@10
```

{@includeCode ../examples/exports.ts}

Use `exports: [geoTiff()]` for only GeoTIFF, or any subset of the example's `formats`. Prefer per-format imports: absent imports allow the bundler to exclude unused codecs and reports. The root plugin barrel is tree-shakeable and contains factories/types. A registered factory lazily loads its implementation when `controller.export(id)` runs. Registration does not start workers. Dynamic imports may create deployment assets at build time without downloading those assets on initial page load.

| Factory | ID | Artifacts |
| --- | --- | --- |
| `geoTiff()` | `geotiff` | North-up 8-bit RGB/RGBA GeoTIFF |
| `jpeg()` | `jpeg` | JPEG, `.jgw` world file, `.crs.json` sidecar |
| `pdf()` | `pdf` | PDF map/alignment report with embedded diagnostics |
| `worldFile()` | `world-file` | Normalized source PNG, `.pgw`, CRS metadata; Linear/Helmert only, or also affine with `worldFile({ affine: true })` |
| `session()` | `session` | Complete session JSON, including unfinished alignment |
| `points()` | `points` | QGIS `.points`; pass custom projection definitions if required |
| `accuracy()` | `accuracy` | Full-precision JSON diagnostics |

`controller.export(id)` returns `{ format, document, blob, files, raster?, worldFile? }`. The primary artifact is both `blob` and `files[0].blob`. Save all files with their suggested names. The controller attaches the frozen document revision that the plugin actually processed; newer drawing edits remain dirty. The React `onExport(result)` callback intercepts all formats instead of downloading them. Downloading session JSON is distinct from acknowledging host persistence.

`controller.setExportFormats([...])` replaces the runtime registry and cancels active export work. Missing IDs, invalid fits and concurrent exports reject before processing. Load/processing failures return null and expose a retryable error in the snapshot. Cancellation, image replacement, alignment changes and suspension discard stale results. Aborting a dynamic import or PDF task cannot undo already-started module loading or synchronous CPU work; its eventual output is ignored. Raster encoding workers are terminated on abort.

## Format details

GeoTIFF supports uncompressed, Deflate and PackBits encoding, with numeric no-data or alpha and an explicit output EPSG code. Its encoder runs in a separate worker. TIFF-specific options remain in the version-1 document schema for compatibility; they do not enable TIFF export. JPEG ignores TIFF compression/predictor creation options.

JPEG shares the full-resolution warp and output grid with GeoTIFF, then composites alpha over an RGB background (white by default). Quality is a number from 0 to 1, default 0.92. It is lossy and has no embedded CRS. Keep the `.jgw` and `.crs.json` sidecars with it. The world file uses the upper-left **pixel centre**, with a negative y pixel size. The returned raster contains the original pre-encoding RGBA pixels; the JPEG bytes contain the flattened, lossy image.

PDF uses the current aligned preview for a local report, not a geospatial PDF raster. `pdf({ map: () => hostMap })` resolves the host map at export time. Other options include paper, margins and attribution. Host-map capture uses currently loaded CORS-safe canvas layers; omit `map` for an aligned-raster report. pdf-lib loads only on demand. Import low-level `createPdfReport` from `@georeferencing/plugins/report` when managing the report lifecycle yourself.

## Convenience aliases

`exportRaster()` is a convenience alias for `export("geotiff")`; `exportWorldFile()` aliases `export("world-file")`. Both require their plugins. Low-level core interchange functions are available for serialization and custom integrations.

See [worker deployment](./workers-and-deployment.md) for encoder asset overrides and license requirements.

## Pure serializers

Import `exportPoints`, `worldFile` and `accuracyReport` from
`@georeferencing/plugins/serializers` when text/placement results are needed without
a controller export. Earlier workspace builds exposed these from core; update those
imports to the plugins entry point. The `worldFile()` plugin factory at `/data`
is unchanged. `importPoints` and `parseSession` remain in core.
