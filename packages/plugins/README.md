# @georeferencing/plugins

Optional local export formats for `@georeferencing/core`: GeoTIFF, JPEG, PDF,
normalized-image world files, JSON sessions, QGIS control points and accuracy
reports. Each format is enabled explicitly through controller configuration.
Heavy implementations load when the user requests an export.

This package has no React or OpenLayers dependency. The optional PDF map contract
is structural and accepts an OpenLayers map. The React editor reads the same
controller registry to display only configured export actions.

## Installation and package selection

```sh
pnpm add @georeferencing/core @georeferencing/plugins
# Add the UI only if needed:
pnpm add @georeferencing/react react@19 react-dom@19 ol@10
```

The package ships ESM, TypeScript declarations and codec-worker assets. Node.js
22.12+ is the declared tooling requirement; repository development uses pnpm 12.x.
Use matching releases of the public packages. For unpublished releases, build
local tarballs with `pnpm pack:packages` and follow the
[local installation guide](https://github.com/tobilg/georeferencing/blob/main/packages/documentation/guides/getting-started.md#install-unpublished-local-tarballs).

Core alone enables no exports. Import only the factories your application uses.
The root plugin barrel exports factories and types; per-format imports give
bundlers a narrower dependency graph. Unused formats can be excluded from the
browser bundle. Installing this package also installs its `pdf-lib` dependency,
but PDF code is downloaded by the application only when its lazy export path runs.

## Pure serializers and import migration

`@georeferencing/plugins/serializers` exposes `exportPoints(document, definitions?)`,
`worldFile(fit, workingCrs, outputCrs)` and `accuracyReport(document, fit)` without
loading a codec worker or UI. These return text/placement values; the `/data`
factories register full controller exports and downloadable artifacts.

```ts
import { importPoints, parseSession } from "@georeferencing/core";
import { exportPoints, accuracyReport, worldFile } from "@georeferencing/plugins/serializers";
```

Earlier workspace builds exported these three serializers from core. This is an
intentional import-path change: move those imports to `/serializers`. Session
validation and `.points` importing remain in core. The `worldFile()` factory at
`@georeferencing/plugins/data` and the plugin root retains its existing API.

## Configure export formats

```ts
import { GeoreferencerController } from "@georeferencing/core";
import { createWorkerEngine } from "@georeferencing/core/engine";
import { geoTiff } from "@georeferencing/plugins/geotiff";
import { jpeg } from "@georeferencing/plugins/jpeg";
import { pdf } from "@georeferencing/plugins/pdf";

export function createExportEditor(workingCrs: string) {
  const engine = createWorkerEngine();
  const controller = new GeoreferencerController({
    workingCrs,
    engine,
    exports: [
      geoTiff(),
      jpeg({ quality: 0.92, background: [255, 255, 255] }),
      pdf({ paper: "A4", landscape: true, attribution: "Host-provided attribution" }),
    ],
  });
  return { controller, engine };
}
```

The caller loads an image and supplies GCPs through the controller or React UI.
Raster/report exports require a current valid fit. Dispose the controller and
its host-owned engine when the session is permanently finished.

| Factory | Import suffix | Format ID | Files / eligibility |
| --- | --- | --- | --- |
| `geoTiff()` | `/geotiff` | `geotiff` | Georeferenced TIFF; valid fit |
| `jpeg()` | `/jpeg` | `jpeg` | JPEG, `.jgw`, `.crs.json`; valid fit |
| `pdf()` | `/pdf` | `pdf` | PDF alignment/map report; valid fit and preview |
| `worldFile()` | `/data` | `world-file` | Original-resolution normalized PNG, `.pgw`, CRS sidecar; Linear/Helmert without reprojection |
| `session()` | `/data` | `session` | Complete session JSON; fit may be unfinished |
| `points(definitions?)` | `/data` | `points` | QGIS `.points`; fit may be unfinished |
| `accuracy()` | `/data` | `accuracy` | Full-precision JSON diagnostics; valid fit |

All controller exports currently require loaded source image bytes. Register data
exports only when needed:

```ts
import type { Definitions, GeoreferencerController } from "@georeferencing/core";
import { accuracy, points, session, worldFile } from "@georeferencing/plugins/data";

export function enableDataExports(
  controller: GeoreferencerController,
  definitions: Definitions,
) {
  controller.setExportFormats([session(), points(definitions), accuracy(), worldFile()]);
}
```

`setExportFormats` replaces the entire registry and cancels pending export work;
it does not append formats. IDs must be unique. Configuration is runtime state,
separate from saved session JSON. Removing all formats leaves alignment and host
feature/draft saving available.

## Run an export and consume every artifact

```ts
import type { ExportResult, GeoreferencerController } from "@georeferencing/core";

export async function exportSelected(
  controller: GeoreferencerController,
  id: string,
  consume: (result: ExportResult) => Promise<void>,
) {
  const unavailable = controller.getExportUnavailable(id);
  if (unavailable) throw new Error(unavailable);
  const result = await controller.export(id);
  if (result) await consume(result);
  return result;
}
```

`ExportResult` contains:

| Field | Meaning |
| --- | --- |
| `format` | Registered format ID |
| `document` | Frozen document revision actually processed |
| `blob` | Primary encoded artifact, also `files[0].blob` |
| `files` | Suggested filename and Blob for every artifact, including required sidecars |
| `raster` | Optional full-resolution, pre-encoding RGBA raster, bounds and CRS |
| `worldFile` | Optional original-pixel placement text and explicit CRS |

Save/download each `files` entry with its filename. The React component's
`onExport(result)` intercepts this same result instead of default downloads.
Hosts that create object URLs must revoke them after use. A completed export is
not a persistence acknowledgement and does not clear the dirty flag.

Missing formats, invalid eligibility and concurrent exports reject before work
starts. Lazy-load/processing failures return `null` and populate snapshot errors;
the operation can be retried. Cancellation and stale work also return `null`.
Use `cancelExport()` to abort. Image replacement, re-alignment, suspension and
format-registry changes discard obsolete outputs. Newer drawing edits can remain
in the draft while the result retains the exact earlier document snapshot.

`exportRaster()` is an alias for `export("geotiff")`, and `exportWorldFile()`
aliases `export("world-file")`. Their matching plugins must be registered.

## GeoTIFF output

`geoTiff()` uses the core full-resolution warp followed by a dedicated codec
worker. Configure spatial and creation settings through `controller.setOutput`:

```ts
import type { GeoreferencerController } from "@georeferencing/core";

export function configureTiff(controller: GeoreferencerController) {
  controller.setOutput({
    ...controller.getSnapshot().document.output,
    crs: "EPSG:3857",
    resolution: [2, 2], // two output-CRS units per pixel; choose for your data
    resampler: "bilinear",
    compression: "deflate",
    rowsPerStrip: 256,
    predictor: 2,
  });
}
```

| Setting | Behavior |
| --- | --- |
| `crs` | Explicit output CRS; register required definitions with the engine |
| `bounds` | Optional outer-edge crop extent in output CRS |
| `resolution` | Positive x/y pixel sizes in output units; omitted means estimated resolution |
| `resampler` | `nearest`, `bilinear`, `cubic`, `cubicSpline` or `lanczos` |
| `compression` | `none`, `deflate` or `packbits` |
| `rowsPerStrip` | Integer 1–4096; default bounded by 256 and raster height |
| `predictor` | 1 or 2; horizontal predictor 2 requires Deflate |
| `sourceNoData` | Source byte or RGB triple excluded before interpolation |
| `noData` | Optional output byte 0–255 with a GDAL no-data tag; otherwise retain alpha |

Output is north-up, PixelIsArea, 8-bit RGB or unassociated RGBA. Bounds locate
outer pixel edges; the first row is at maxY. Numeric no-data cannot preserve
partial alpha; choose a value that does not collide with valid RGB data. Deflate
requires browser CompressionStream support.

This encoder writes classic TIFF below 4 GiB and requires an EPSG code below
32767. BigTIFF, COG layout, arbitrary-WKT GeoKeys, scientific sample preservation
and multipage output are outside the supported envelope. See the
[capabilities and limits](https://github.com/tobilg/georeferencing/blob/main/packages/documentation/guides/capabilities.md)
for the supported output envelope and QGIS compatibility boundaries.

## JPEG output

`jpeg({ quality, background })` shares the same full-resolution warp and output
grid, then encodes a lossy JPEG. `quality` is 0–1, default 0.92. `background` is an
RGB byte tuple, default white; transparent pixels are composited onto it.
TIFF compression and predictor settings do not affect JPEG.

JPEG has no embedded CRS. Keep all three files together: the image, `.jgw` world
file and `.crs.json` metadata. The world file uses the upper-left pixel centre and
negative y pixel size. JSON records CRS, bounds, dimensions, source identity,
revision and encoding options. `result.raster` retains the unflattened RGBA warp;
decoded JPEG pixels can differ because of alpha composition and lossy encoding.

## PDF and supplementary exports

`pdf()` creates a report from the aligned preview, including GCPs/residuals,
parameters, source/revision information and an embedded full-precision JSON
attachment. It is a report, not a geospatial PDF raster export.

Options include `paper` (`A4`, `A3`, `Letter`), `landscape`, `margin` in PDF points,
projection `definitions`, `attribution` and an optional `map` or map accessor.

```ts
import { pdf, type ReportMap } from "@georeferencing/plugins/pdf";

export function mapReport(currentMap: () => ReportMap | undefined) {
  return pdf({ map: currentMap, paper: "A4", margin: 40 });
}
```

The accessor resolves the current map at export time. Capture uses currently
loaded canvas layers without moving the view or waiting for pending tiles. Map
sources must permit CORS canvas export. WebGL-only renderers and arbitrary DOM
overlays are outside this capture contract. Omit `map` for an aligned-raster-only
report. PDF cancellation discards a late result but cannot interrupt synchronous
PDF generation or undo a module download.

The `worldFile()` plugin exports orientation-normalized original-resolution PNG
pixels with matching placement; a world file itself contains no CRS. QGIS
`.points` exports use the QGIS source-y convention and placeholder residual
columns; use `accuracy()` for computed diagnostics. A session download preserves
metadata and features, but not original file bytes, undo history or credentials.
Neither a downloaded session nor a report counts as a host save.

## Worker assets and memory

With Vite, use `worker: { format: "es" }`. Default codec URLs resolve relative to
the installed plugin module, including packed consumers. Each codec can override
its worker independently:

```ts
import { geoTiff } from "@georeferencing/plugins/geotiff";
import { jpeg } from "@georeferencing/plugins/jpeg";

export const formats = [
  geoTiff({ workerUrl: "/my-app/assets/geotiff.js" }),
  jpeg({ workerUrl: "/my-app/assets/jpeg.js", quality: 0.9 }),
];
```

Copy the matching `dist/workers/geotiff.js` or `jpeg.js`, adjacent legal notices
and `dist/licenses` when deploying assets yourself. Alternatively supply a
`workerFactory` returning a fresh dedicated module worker. Vite supports asset
imports from `@georeferencing/plugins/geotiff-worker?worker` and
`@georeferencing/plugins/jpeg-worker?worker`. Respect the deployment base and CSP.

Raster codecs inherit engine limits, projection definitions, scheduling and
cancellation. Temporary raster buffers transfer to the encoder and back; the
editor preview is never transferred. Low-level callers must treat submitted
buffers as detached until the returned raster arrives. Aborting terminates a
codec worker. Core defaults are 24MP input/output and 768 MiB estimated reservation;
compression and buffers may require a smaller practical output. These estimates
are not measured process-memory caps or streaming guarantees.

## Custom exporters and low-level APIs

A custom descriptor implements core's `ExportFormat` contract; it does not need
to depend on this package. Respect the supplied AbortSignal and frozen document.
The first file's Blob must be the primary returned Blob.

```ts
import type { ExportFormat } from "@georeferencing/core";

export const provenance: ExportFormat = {
  id: "provenance",
  label: "Export provenance",
  requiresFit: false,
  load: async () => ({
    async run({ document, signal }) {
      signal.throwIfAborted();
      const blob = new Blob([JSON.stringify({
        documentId: document.id,
        revision: document.documentRevision,
        source: document.sourceImage,
      })], { type: "application/json" });
      return { blob, files: [{ name: "provenance.json", blob }] };
    },
  }),
};
```

For a larger implementation, have `load` dynamically import your own module.
Use `raster: true` to request shared raster output controls, and `unavailable` for
additional pure eligibility checks. All exporters share the controller's revision
and cancellation contract.

`@georeferencing/plugins/tiff` exposes low-level TIFF encoders and option
validation. `/report` exposes `createPdfReport`, `captureMap` and structural map
interfaces. Bypassing the controller makes the caller responsible for matching
revisions, limits, cancellation and resource cleanup. Custom codec workers can
use `installEncoderWorker` from `@georeferencing/core/encoder-worker`.

## Migration, development and troubleshooting

React components/CSS now live in `@georeferencing/react`. TIFF encoders moved from
core's engine entry to `/tiff`; PDF helpers moved from React to `/report`.
Configure PDF options in `pdf({...})`, replacing the old React `reportOptions`
prop. Use the unified React `onExport` for every format, including world files.
See the complete
[migration guide](https://github.com/tobilg/georeferencing/blob/main/packages/documentation/guides/export-plugins.md#migration-from-the-combined-core-package).

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build:packages
pnpm typecheck
pnpm test
pnpm test:browser
pnpm docs:build
pnpm pack:plugins
pnpm test:consumer
```

| Symptom | Check |
| --- | --- |
| No export buttons / `EXPORT_DISABLED` | Register the intended format on the controller |
| Lazy module or codec load fails | Bundler output, asset base URL and CSP; retry after correcting deployment |
| JPEG appears unreferenced in another app | Keep both sidecars and configure/read the recorded CRS |
| PDF cannot capture a map | Loaded canvas layers, visible map size and CORS; omit optional map capture if unsupported |
| TIFF option or memory error | Compatible compression/predictor/no-data settings and output size |

MIT licensed, with bundled third-party notices in `dist/licenses`. Public TypeDoc
comments ship in declarations and are sourced into the shared
[documentation website](https://github.com/tobilg/georeferencing/tree/main/packages/documentation).
