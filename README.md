# Georeferencing workspace

A reusable React 19 editor for placing local images on an existing OpenLayers
map, exporting a real GeoTIFF, and optionally drawing/saving geographic features.
Image processing runs in browser workers. Reference services and persistence are
supplied by the host. See the [capabilities and limits](packages/documentation/guides/capabilities.md) for the supported ordinary-image envelope.

This repository uses pnpm workspaces:

- [`packages/core`](packages/core/README.md): **@georeferencing/core**, headless sessions, transforms, browser processing and OpenLayers adapters. No React or PDF dependency.
- [`packages/plugins`](packages/plugins/README.md): **@georeferencing/plugins**, optional GeoTIFF, JPEG, PDF and data exports, with per-format entry points and lazy implementations.
- [`packages/react`](packages/react/README.md): **@georeferencing/react**, ready-made editor, composable panels, hooks and scoped CSS. Uses the formats configured on its controller.
- [`packages/demo`](packages/demo/README.md): **@georeferencing/demo**, a private Vite integration using all three public packages.
- [`packages/documentation`](packages/documentation/README.md): **@georeferencing/documentation**, a private TypeDoc website generated from all three public packages.
- [`tests/reference`](tests/reference/README.md): independent QGIS/GDAL verification; [`tests/fixtures`](tests/fixtures/README.md) holds committed reference inputs and expected values.
- [`tests/consumers`](tests/consumers/README.md): standalone applications installed from local tarballs.
- [`benchmarks`](benchmarks/README.md): browser processing and resource measurements.
- Root `scripts/`: shared builds, packing and verification runners. `licenses/` holds third-party notices; ignored `artifacts/reports/` holds generated measurements. See [releasing](RELEASING.md).

Use Node.js 22.12+ and an installed **pnpm 12.x**. `engines.pnpm` requires the
major version without an exact `packageManager` pin or package-manager download
in the lockfile. The root workspace, demo and documentation site are private.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Run commands above from the repository root. `pnpm dev` builds and watches core, plugins and React
source/styles alongside the demo. `pnpm build` builds all packages in dependency
order; `pnpm build:core` builds just the library. Demo output is
`packages/demo/dist/`, library output is `packages/core/dist/`.

## API documentation website

```sh
pnpm docs:dev      # Generate, watch and serve at http://127.0.0.1:4174
pnpm docs:build    # Static HTML/search assets in packages/documentation/dist
pnpm docs:preview  # Serve the existing build
pnpm test:docs     # Strict TypeDoc validation, local links and browser search
```

The [documentation workspace](packages/documentation/README.md) follows the
TypeDoc HTML setup used by CereusDB. Public API comments also ship in all three public
packages' `.d.ts` files for editor help. Missing public documentation and invalid
links fail the docs build; guide examples are checked by `pnpm typecheck`.
The generated website can be served at a non-root base path. These commands do
not publish the npm package or deploy the website.

Open the printed local URL and choose **Try the Hamburg example**. Select a point
in the image, then its matching map location; repeat and choose **Run alignment**.
The demo defaults to manual preview and offers an explicit automatic option. Its
reference map uses OpenStreetMap tiles centered on Hamburg and requires internet. Export
or accept alignment to draw, then save through the labeled localStorage adapter.
Automated integration and engine checks use separate
[test harnesses](tests/browser/harness/README.md), served with `pnpm dev:harness`.

## Install the local package

```sh
pnpm pack:packages
# In your application:
pnpm add /absolute/path/georeferencing/artifacts/georeferencing-{core,plugins,react}-0.1.0-alpha.2.tgz
```

Until the packages are published, pnpm must resolve the shared core dependency
from the local tarball too. Before the consumer's `pnpm add`, place this in its
`pnpm-workspace.yaml` (replace the path):

```yaml
overrides:
  '@georeferencing/core': file:/absolute/path/georeferencing/artifacts/georeferencing-core-0.1.0-alpha.2.tgz
```

The [pnpm settings reference](https://pnpm.io/settings) documents this configuration
location. Registry installations after publication need no local override.

Tested peers: React/React DOM 19.3.0 and OpenLayers 10.10.0. Peer ranges are
`>=19.3.0 <20` and `>=10.10.0 <11`; older versions have not been verified. React
and OL remain owned by the consuming app. Packing creates local archives; see
[release preparation](RELEASING.md) before publishing them.

## Integrate an existing map

```tsx
import { useState } from "react";
import type Map from "ol/Map.js";
import {
  Georeferencer,
  GeoreferencerController,
  type SaveEnvelope,
} from "@georeferencing/react";
import { createWorkerEngine } from "@georeferencing/core/engine";
import { geoTiff } from "@georeferencing/plugins/geotiff";
import { jpeg } from "@georeferencing/plugins/jpeg";
import { pdf } from "@georeferencing/plugins/pdf";
import "@georeferencing/react/styles.css";

export function ImageEditor({
  map,
  persist,
}: {
  map: Map;
  persist: (snapshot: Readonly<SaveEnvelope>) => Promise<void>;
}) {
  const [controller] = useState(
    () =>
      new GeoreferencerController({
        workingCrs: "EPSG:3857", // choose your actual working CRS
        engine: createWorkerEngine(),
        digitizing: true, // omit/false for alignment and raster export only
        exports: [geoTiff(), jpeg(), pdf({ map })], // choose only needed formats
        onChange: (document) => {
          /* mirror draft in host state; not a save receipt */
        },
        onSave: persist,
        // onSaveDraft: async ({ requestId, document }) => saveUnfinishedProject(...),
        onActiveToolChange: (tool) => {
          /* coordinate host tools explicitly */
        },
      }),
  );
  return <Georeferencer controller={controller} referenceMap={map} />;
}
```

The controller is the single authority. Do not mutate its document or replace
image props behind its back. `loadImage(file)`, `removeImage()` and
`restoreSession(json, file)` all use the same guard. The built-in UI supplies the
guard dialog; headless integrations must configure `guard`, otherwise dirty
replacement is cancelled. Retain the controller to detach/remount the same
session; call `controller.dispose()` when permanently done and `engine.dispose()`
when the host-owned engine is no longer needed. No host map/layer is disposed.

Save receives an immutable, revisioned snapshot with stable feature IDs, source
fingerprint, accepted alignment and per-feature provenance. Replace only that
document's feature collection, including deletions. Resolve after durable storage;
reject on failure. Retry uses the same request ID for the same revision. Edits
during a save remain dirty. Saving never requires a raster export. `onSaveDraft`
handles unfinished projects; downloading session JSON is not persistence.

## Optional export formats

Core enables no exports by default. Install `@georeferencing/plugins` only when needed and register a subset in `ControllerOptions.exports`: `geoTiff()` (`geotiff`), `jpeg()` (`jpeg`), `pdf()` (`pdf`), or the `session()`, `points()`, `accuracy()` and `worldFile()` factories from `/data`. React renders actions only for those descriptors. Feature saving works without export plugins.

Use `controller.export("jpeg")` (or another registered ID) to receive artifacts with a frozen document snapshot. `exportRaster()` and `exportWorldFile()` are convenience aliases requiring their plugins. `setExportFormats([...])` changes formats at runtime and cancels pending exports. Code loads on first use; per-format imports also let the production bundler exclude unused formats entirely.

JPEG exports north-up image bytes plus matching `.jgw` and `.crs.json` files; retain all three. JPEG is lossy and composites alpha over configurable `background: [r,g,b]`, default white; `quality` defaults to 0.92. PDF reports load pdf-lib on demand. The new [export guide](packages/documentation/guides/export-plugins.md) includes migration and custom-plugin examples.

## Workers, assets and projections

The processing engine's default factory uses `new Worker(new URL('./worker.js', import.meta.url),
{ type: 'module' })` from the packed package. It is verified in a clean production
Vite consumer at `/consumer/`, with `worker-src 'self'`. With Vite use:

```ts
export default { worker: { format: "es" } };
```

For a bundler/static hosting policy that needs explicit asset placement:

```ts
const engine = createWorkerEngine({
  workerUrl: "/my-assets/georeferencing-worker.js",
  // Copy the package's dist/engine/worker.js to this same-origin URL.
  // Alternatively provide workerFactory: () => new Worker(myUrl, { type: 'module' }).
  limits: { maxInputPixels: 24_000_000, maxOutputPixels: 24_000_000 },
  definitions: {
    "EPSG:25832": "+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs +type=crs",
  },
});
```

Pass the **same** definitions to the map binding's `bindingOptions.definitions`
(or call exported `registerProjections`). EPSG:3857/4326 are built in. A CRS code
alone does not load definitions or datum grids. GeoTIFF output requires an
EPSG code below 32767. Browser code is lazy and SSR import is tested; no map/worker
is created at module import. No WASM assets, CDN, telemetry or isolation headers
are required. CSS is optional and scoped to `.rg-editor`/`.rg-guard`.

## References and bounds

```ts
import type { BindingOptions } from "@georeferencing/core/openlayers";

const bindingOptions: BindingOptions = {
  references: [
    {
      kind: "wfs",
      id: "buildings",
      label: "Buildings",
      url: "/your-host-proxy/wfs",
      version: "2.0.0",
      typeNames: ["your:buildings"],
      requestCrs: "EPSG:3857",
      responseCrs: "EPSG:3857",
      responseFormat: "geojson",
      axisOrder: "xy",
      loading: "viewport",
      pageSize: 500,
      maxFeatures: 5000,
      // queryBounds: { extent: [minX, minY, maxX, maxY], crs: 'EPSG:3857' },
      request: (url, init) => fetch(url, { ...init, credentials: "include" }),
      snapping: { vertices: true, edges: false, tolerancePx: 10 },
    },
  ],
  digitizingSnapping: { references: true, drafts: true },
  onReferenceStatus: (id, status) => console.log(id, status),
};
// Keep this configuration stable; pass to <Georeferencer bindingOptions={...} />.
```

The endpoint/type names above are placeholders. Configure actual service format,
CRS and axis order explicitly. WFS 1.1 uses `maxFeatures`; startIndex paging is
used only with `supportsStartIndex: true` or supplied paging capabilities, otherwise truncation is visible. GML 3/3.2 uses declared CRS axes, including EPSG URI/URN aliases and CRS84. `responseAxisOrder` can explicitly override a nonstandard service for either format. `responseCrs` is optional: responses otherwise use their declared/requested CRS. Missing IDs require `idProperty`. HTTP-200 OGC exceptions are errors.
Requests are debounced and abortable; late results cannot populate a newer binding.
Only the current reference results are retained, with no unbounded extent cache.

Other providers: `{ kind: 'existing-vector', id, label, layer, snapping }` borrows
an ordinary vector layer/source without duplicating requests or altering it;
`{ kind: 'geojson', id, label, data, crs }`; and
`{ kind: 'custom', id, label, queryCrs, load: async ({ extent, crs, resolution,
signal }) => ({ data, crs, partial }) }`. Clustered/vector-tile references require
a separate precise geometry source. Query resolution is in current map units.

`initialView` only frames the host map once per attachment. Reference `queryBounds`
limits requests, `drawingBounds` on the controller constrains accepted features
in longitude/latitude, and `document.output.bounds` crops raster output. These
are independent. A bounding box never georeferences the input image. Query bounds
do not clip returned geometry; drawing bounds are checked at acceptance. Manual
coordinate/map picking works while reference services are unavailable.

## UI and interchange

Use `useGeoreferencer`, `ImagePanel`, `GcpPanel`, `AlignmentPanel`, `ReferencePanel`, `FeaturePanel`
and `attachReferenceMap` for custom layouts. Pass `t(message)` to translate UI
labels. `formatError({ code, message, operationId, recoverable })` localizes dynamic errors by stable code; headless hosts can use `onError` and `snapshot.errorDetail`. `propertyEditor(feature, update)`
renders host fields without reserving business property names. Use `onExport`
to receive a Blob, exact processed document snapshot and raster metadata instead
of triggering the built-in downloads. The unified `onExport(result)` receives `format`, `files`, `blob`, exact `document`, and optional raster/world-file metadata. `pdf({...})` controls paper, margins, attribution and optional host-map composition.

Original normalized pixels are top-left corner/Y-down, with centers at 0.5.
Paired points are committed atomically; endpoints can be dragged or entered
numerically, disabled, deleted, undone/redone. Model count/rank/domain validation
blocks stale or invalid confirmation/export. Once drawing, GCP changes are locked
until returning to alignment. Drawings remain geographic; changing alignment
requires reconfirmation and explicit review before another accepted save.

QGIS `.points` import supports current `sourceX/sourceY` and older
`pixelX/pixelY`, enabled flags and negative source Y. CRS comments may be EPSG
identifiers or supported WKT. Export includes the 3.44 header; residual columns
are placeholders recomputed by QGIS on load. Session JSON includes all revisions,
GCPs, features/properties and provenance; unknown future schemas are rejected.
Restoring requires the matching file bytes. Undo history and credentials are not
serialized. See [coordinate guide](packages/documentation/guides/coordinates-and-output.md).

## Supported processing and validation

PNG: 8-bit, nonanimated. JPEG: ordinary 8-bit grayscale/RGB. WebP: static lossy/lossless RGB/RGBA, with animation rejected. All eight EXIF orientations are explicitly normalized for PNG, JPEG and WebP. TIFF: one page, orientation 1, chunky unsigned 8-bit
grayscale/RGB/unassociated RGBA; uncompressed, LZW, Deflate or PackBits. Other
encodings fail explicitly. Existing GeoTIFF placement is only a displayed hint.
Canvas color management can affect color profiles; scientific-band preservation
is not supported by this alpha.

Seven models and five resamplers share the preview/export mapping. Exports are
uint8 RGBA GeoTIFF with unassociated alpha, or RGB with numeric no-data.
`output.compression` supports `none`, `deflate`, and `packbits`;
`rowsPerStrip` defaults to 256 (1–4096); `predictor: 2` enables horizontal
prediction with Deflate. Encoding writes bounded strips into a Blob.
`sourceNoData` excludes one byte or an RGB triple before resampling.
`noData` sets the output byte value/tag; omit it to preserve alpha. Numeric
no-data cannot represent partial transparency and rejects that combination.
Choose an unused byte value to avoid treating valid RGB samples as no-data.

Default limits: 25 MiB compressed, 24MP input/output, 768 MiB estimated reservation,
768px preview edge, 128 GCPs. Full-resolution export decodes retained original
bytes. Deflate reserves extra working memory, so its maximum output may be lower.
The reservation is an allocation estimate, not a browser process RSS cap; browser
process memory can be substantially higher. Benchmark the intended devices and workload.
See [capabilities and limits](packages/documentation/guides/capabilities.md). COG, multi-page/scientific
sample preservation, arbitrary-WKT TIFF output and automatic antimeridian splitting
are outside this declared envelope; unsupported requests fail explicitly.

World files are limited to Linear/Helmert without reprojection. The ready UI and
`controller.exportWorldFile()` include an original-resolution, orientation-normalized
PNG, a `.pgw` file and explicit CRS metadata, so oriented JPEG/PNG placement is
consistent. The pure `worldFile()` helper describes canonical normalized pixels.

Full/local histogram stretch, brightness/contrast and image/map view histories
change the view only. Arrow keys and +/- navigate the focused image viewer;
numeric GCP inputs provide keyboard point placement. PDF output contains the
aligned raster, GCP/residual plot, model parameters, source identity, revisions,
and embedded full-precision Unicode JSON. Canvas-based host-map layers can be
included; map sources must allow CORS export. Omit the `pdf()` map option or call `createPdfReport` without a map when the host renderer cannot be
captured. The snapshot documents currently loaded layers; it never moves the map.

Optional service discovery:

```ts
import {
  discoverWfs,
  describeWfsFeatureType,
} from "@georeferencing/core/openlayers";
const signal = new AbortController().signal;
const service = {
  url: "/your-host-proxy/wfs",
  version: "2.0.0" as const,
  signal,
};
const capabilities = await discoverWfs(service);
const fields = await describeWfsFeatureType(service, ["your:buildings"]);
// Supply capabilities to the WFS provider, or keep explicit configuration.
```

Metadata requests support the same injected authenticated `request` function.
`maxResponseBytes` defaults to 20 MiB per response, independent of page/feature
limits. Services remain read-only. Missing projection definitions and mandatory
datum grids fail; the package never silently drops a required grid:

```ts
import {
  createJobScheduler,
  createWorkerEngine,
} from "@georeferencing/core/engine";
const scheduler = createJobScheduler(1); // share across editor engines
const datumGrids = { "regional.gsb": await gridFile.arrayBuffer() };
const definitions = {
  "HOST:REGIONAL":
    "+proj=longlat +ellps=WGS84 +nadgrids=regional.gsb +type=crs",
};
const engine = createWorkerEngine({ definitions, datumGrids, scheduler });
const bindingOptions = { definitions, datumGrids };
```

The grid definition above is illustrative: use the actual licensed NTv2 resource
and CRS definition for your region. Hosts retain/version those resources alongside
sessions; buffers and credentials are never serialized in the document. Other grid
encodings must be converted to supported NTv2 before registration.

Default saves remain RFC 7946 geographic GeoJSON. For explicit alternative host
coordinates use `featuresInCrs(features, crs, tolerance, definitions)` from `/core`.
It preserves IDs/properties, densifies segments to the requested output-unit
tolerance, and returns a distinct `ProjectedFeatureCollection` envelope.

Development uses **pnpm 12.x** (any compatible minor/patch; no exact pin),
Node.js **22.12 or newer**, Vite **8.3.2**, Vitest **4.1.11**,
and Biome **2.5.15**. Biome checks formatting, recommended lint rules and imports;
TypeScript checks types and unused source declarations separately. `biome.json`
respects `.gitignore` and excludes the lockfile, generated evidence and reference
fixtures. Markdown and Python remain outside Biome's supported formatting scope.
The recommended preset is enabled with non-null assertions allowed for existing
validated engine/session invariants. Custom field components are registered as
inputs, and narrowly scoped suppressions explain keyboard map targets, fixed
histogram bins and the source-identity reset effect.
See the [Vite 8 migration guide](https://vite.dev/guide/migration) and
[Biome configuration reference](https://biomejs.dev/reference/configuration/).

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint                 # Biome formatting, lint and import checks
pnpm lint:fix             # apply safe Biome fixes
pnpm format               # format supported files with Biome
pnpm format:check         # check formatting without changing files
pnpm test
pnpm build
pnpm build:demo
pnpm test:browser         # starts demo + harness; installed Chromium, Firefox, WebKit
pnpm test:consumer        # packs, installs, builds, tests a clean consumer
# In a separate terminal, after building the packages:
# pnpm dev:harness
# With that harness server running and native GDAL installed:
node tests/reference/engine-check.mjs
node tests/reference/native-reference.mjs
node tests/reference/tiff-options.mjs
node tests/reference/world-file-reference.mjs
node benchmarks/benchmark-all.mjs
# Docker with the pinned official QGIS image:
node tests/reference/qgis-reference.mjs
node tests/reference/qgis-invalid-reference.mjs
node tests/reference/qgis-points.mjs
node tests/reference/raster-parity.mjs --generate
```

Independent QGIS/datum/raster fixtures are committed under `tests/fixtures`; the
regression tests require neither private reports nor native GIS installations.
Native tools are needed only for regenerating those reference fixtures. See [release preparation](RELEASING.md),
[capabilities and limits](packages/documentation/guides/capabilities.md) and
[save semantics](packages/documentation/guides/lifecycle-and-saving.md).
