# @georeferencing/core

Headless image georeferencing for browser applications. Core owns serializable
sessions, control points, transformation fitting, raster warping, revision-safe
processing, feature drafts and host persistence callbacks. It also provides
optional adapters for an existing OpenLayers map.

Image processing runs locally in browser workers. Reference services and saving
are supplied by the host. Core has no React or PDF dependency and enables no file
export formats by default. Use
[`@georeferencing/react`](https://github.com/tobilg/georeferencing/tree/main/packages/react)
for an editor UI and
[`@georeferencing/plugins`](https://github.com/tobilg/georeferencing/tree/main/packages/plugins)
for optional GeoTIFF, JPEG, PDF and data downloads.

## Installation and compatibility

```sh
pnpm add @georeferencing/core
# Only when using the OpenLayers adapters:
pnpm add ol@10
```

The package ships ESM and TypeScript declarations with TypeDoc comments. Node.js
22.12 or newer is the declared tooling requirement. OpenLayers is an optional
peer with the verified range `>=10.10.0 <11`; headless consumers need no map library.
Browser processing requires module workers, File/Blob, OffscreenCanvas and Web
Crypto in a secure context. Importing the package and constructing an engine are
SSR-safe; start image processing on the client.

`@georeferencing/core`, `@georeferencing/plugins` and `@georeferencing/react` are
released together. **Install the same version of every `@georeferencing/*` package**
and upgrade them together. Plugins and React depend on core; mismatched versions
can install a second copy of core with its own proj4 projection registry, so
projections registered through one copy are invisible to the other. See
[keep package versions aligned](https://georeferencing-api-docs.gh.tobilg.com/Getting_started/#keep-package-versions-aligned).

API reference and guides: **[georeferencing-api-docs.gh.tobilg.com](https://georeferencing-api-docs.gh.tobilg.com)**.

## Public entry points

| Import | Purpose |
| --- | --- |
| `@georeferencing/core` | Controller, documents, GCPs, transforms, projections, geometry validation, interchange and export contracts |
| `@georeferencing/core/core` | Alias for the root headless API |
| `@georeferencing/core/engine` | Lazy worker engine, shared scheduler, raster types and numerical raster helpers |
| `@georeferencing/core/openlayers` | Map attachment, reference providers, WFS discovery and geometry conversion |
| `@georeferencing/core/worker` | Bundled processing worker asset for bundler imports or custom deployment |
| `@georeferencing/core/encoder-worker` | Protocol for implementing an optional raster codec worker |

Worker assets are loaded as workers, not imported into an SSR application as
ordinary modules. The core render operation returns RGBA pixels; file encoding
is a separate optional plugin operation.

## Create a headless session

Create one stable controller per editor session. Inject real host services where
needed; this example supplies no persistence implementation or automatic discard
policy. `align` takes actual image/map control point pairs from your UI.

```ts
import {
  GeoreferencerController,
  type ControllerOptions,
  type Gcp,
} from "@georeferencing/core";
import { createWorkerEngine } from "@georeferencing/core/engine";

export function createEditor(
  workingCrs: string,
  services: Pick<
    ControllerOptions,
    "onChange" | "onSave" | "onSaveDraft" | "guard" | "onError"
  > = {},
) {
  const engine = createWorkerEngine();
  const controller = new GeoreferencerController({
    workingCrs,
    engine,
    previewMode: "manual",
    ...services,
  });

  return {
    controller,
    async align(file: File, gcps: Gcp[]) {
      if (!(await controller.loadImage(file))) return false;
      controller.setModel("polynomial1");
      controller.replaceGcps(gcps);
      // Manual mode fits only when explicitly requested.
      await controller.refit();
      const state = controller.getSnapshot();
      if (!state.fit || state.fitRevision !== state.document.alignmentRevision) {
        throw new Error(state.error ?? "The alignment is not valid.");
      }
      return true;
    },
    dispose() {
      controller.dispose();
      engine.dispose();
    },
  };
}
```

`controller.subscribe(listener)` returns an unsubscribe function. Read
`controller.getSnapshot()` inside the listener to obtain the current frozen
`document`, fit, preview, operation statuses, diagnostics, dirty state and errors.
Do not mutate snapshots. Files, workers, maps, decoded buffers and export
configuration are runtime resources, outside the serializable document.

For a purely numerical affine fit, this synthetic example is independent of any
loaded image or browser worker:

```ts
import { fitTransform, forward, type Gcp } from "@georeferencing/core";

const gcps: Gcp[] = [
  { id: "a", label: 1, enabled: true, image: [0, 0], target: [1000, 2000], crs: "EPSG:3857" },
  { id: "b", label: 2, enabled: true, image: [100, 0], target: [1200, 2000], crs: "EPSG:3857" },
  { id: "c", label: 3, enabled: true, image: [0, 100], target: [1000, 1700], crs: "EPSG:3857" },
];
const fit = fitTransform(gcps, "polynomial1");
const coordinate = forward(fit, [50, 50]); // approximately [1100, 1850]
console.log(coordinate);
```

The numerical API expects targets already expressed in one working CRS. Worker
fitting projects each GCP from its declared CRS. Before rendering direct numerical
fits, use `validateDomain`; point count alone does not establish a valid transform.

## Controller workflow and image lifecycle

| Operation | Behavior |
| --- | --- |
| `loadImage(file)` | Inspect a selected image, guard dirty replacement, retain original bytes and create a reduced preview |
| `setPendingPoint`, `addGcp`, `updateGcp`, `removeGcp`, `replaceGcps` | Create/edit paired points; invalidate confirmation and follow the preview policy |
| `setModel`, `setWorkingCrs`, `setOutput` | Change transformation or output settings through revisioned edits |
| `undo`, `redo` | Restore edits while keeping revisions monotonic |
| `setPreviewMode(mode)` | Switch manual/automatic preview without changing document revisions |
| `refit()` | Fit and render the latest preview; failures update snapshot state |
| `confirm()` | Accept the exact current valid image/alignment revision for digitizing |
| `returnToAlignment()`, `reviewFeatures()` | Re-align without moving geographic drawings, then explicitly review them |
| `setFeatures`, `deleteFeature` | Update separate geographic feature drafts with stable IDs |
| `save()`, `save("draft")` | Submit an immutable snapshot to the matching host callback |
| `removeImage()`, `restoreSession(json, file)` | Guard destructive transitions and cancel obsolete processing |
| `suspend()`, `start()` | Pause/resume retained image and document resources across UI attachment cycles |

The controller defaults to `previewMode: "automatic"` for existing integrations.
Set `previewMode: "manual"` to collect pairs before calling `await controller.refit()`.
Use `controller.setPreviewMode("manual" | "automatic")` at runtime and read
`snapshot.previewMode`. This transient preference does not change document revisions
or get persisted in session JSON.

Automatic mode waits for the selected model's minimum complete, enabled pairs;
insufficient points during collection are a readiness state. Every requested fit
still validates rank, conditioning and domain in the worker. Manual mode applies
to GCP/model edits, undo/redo, session restore and remount. Changes clear the old
fit/preview immediately, block acceptance/export and invalidate alignment review
where placement changed. Complete or cancel a pending pair before calling `refit`.
Switching to manual cancels an in-flight preview and rejects late results;
switching to automatic starts a missing eligible preview. A valid existing preview
is retained when only the policy changes. Final raster export is always explicit.

Image selection is dynamic. Dirty transitions require a host `guard` returning
`"save"`, `"discard"` or `"cancel"`; absent a guard, dirty replacement is cancelled.
The ready-made React editor supplies a dialog. `loadImage`, `removeImage` and
`restoreSession` return a boolean indicating whether the transition succeeded.
Session restoration verifies the supplied image's fingerprint. Store original
image bytes separately if the host needs to resume a session later.

Image replacement cancels old work and resets image-dependent state. The map
binding preserves the host map view. Stale worker/reference results cannot update
a newer image or alignment. `suspend()` retains the draft and original bytes;
`dispose()` is for permanent teardown after detaching the integration. Dispose a
host-owned engine separately only when no other session uses it. Suspension does
not cancel already submitted host save requests.

## Coordinate conventions and transformations

| Space | Convention |
| --- | --- |
| Image | Original-resolution pixels after EXIF normalization; top-left corner `(0, 0)`, y down, first pixel centre `(0.5, 0.5)` |
| GCP target/reference | Coordinate snapshot with an explicit CRS; reference refresh never moves an existing pair |
| Working | Explicit CRS used for fitting, residual units and aligned preview |
| Map view | Host OpenLayers projection, independently configured |
| Raster output | `document.output.crs`, resolution and optional outer-edge bounds |
| Features | RFC 7946 longitude/latitude by default; explicit adapters for other coordinates |

Internal tuples use x/y order. WFS wire axis order is configured independently.
An initial map extent only frames the map. Reference query bounds, geographic
drawing constraints and raster output bounds are separate settings.

| Model ID | Minimum enabled pairs | Transformation |
| --- | ---: | --- |
| `linear` | 2 | Translation and independent axis scales using QGIS conventions |
| `helmert` | 2 | Translation, uniform scale and rotation |
| `polynomial1` | 3 | Affine |
| `polynomial2` | 6 | Second-degree polynomial |
| `polynomial3` | 10 | Third-degree polynomial |
| `projective` | 4 | Homography |
| `thinPlateSpline` | 3 | Thin plate spline with affine terms |

Duplicate/degenerate pairs, deficient rank, poor conditioning and invalid domains
can invalidate any model even with enough points. Models never silently fall
back to affine. Training RMSE is `sqrt(sum(distance²) / enabledCount)` in working
CRS units; it is not independent positional accuracy. Polynomial backward mapping
follows a separately fitted reverse polynomial. See the
[coordinate guide](https://github.com/tobilg/georeferencing/blob/main/packages/documentation/guides/coordinates-and-output.md)
and [capabilities and limits](https://github.com/tobilg/georeferencing/blob/main/packages/documentation/guides/capabilities.md)
for formulas, source comparisons and supported edge cases.

## Attach a map and configure references

The host supplies an initialized visible map. Attach once, then detach during
cleanup. The ready-made React editor already performs this attachment; do not
also call `attachReferenceMap` for the same editor.

```ts
import type { GeoreferencerController, Extent } from "@georeferencing/core";
import { attachReferenceMap, type WfsReference } from "@georeferencing/core/openlayers";
import type OLMap from "ol/Map.js";

export function attachEditor(
  map: OLMap,
  controller: GeoreferencerController,
  service: { url: string; typeNames: string[]; bounds: Extent },
) {
  const reference: WfsReference = {
    kind: "wfs",
    id: "host-reference",
    label: "Host reference features",
    url: service.url,
    version: "2.0.0",
    typeNames: service.typeNames,
    requestCrs: "EPSG:3857",
    responseCrs: "EPSG:3857",
    axisOrder: "xy",
    responseFormat: "geojson",
    loading: "viewport",
    queryBounds: { extent: service.bounds, crs: "EPSG:3857" },
    pageSize: 500,
    maxFeatures: 5000,
    snapping: { vertices: true, tolerancePx: 10 },
    request: (url, init) => fetch(url, { ...init, credentials: "include" }),
  };
  const binding = attachReferenceMap(map, controller, { references: [reference] });
  return () => binding.detach();
}
```

This example assumes projected xy GeoJSON service coordinates. Configure the
actual service CRS, axis conventions and supported output format. Viewport queries
follow map navigation and intersect optional provider bounds. Preserve the
request's AbortSignal when injecting authentication. WFS 1.1 paging requires
explicit support for `startIndex`; truncation and service exceptions are visible.
GeoJSON and GML providers, stable IDs, response-byte limits and capabilities/schema
discovery are described in the
[reference guide](https://github.com/tobilg/georeferencing/blob/main/packages/documentation/guides/reference-data.md).

Other providers are `existing-vector` (borrow an existing layer without duplicate
requests or ownership), `geojson` (static data with a CRS), and `custom` (an
abortable viewport loader returning data and its CRS). GCP snapping and drawing
snapping are separately configured. Manual target entry still works when a
reference loader fails.

## Digitizing and host persistence

Set `digitizing: true` to allow multiple Point, LineString and Polygon features
after confirmation. Core can manage feature collections headlessly; the map
adapter supplies drawing, selection, modification and snapping interactions.
Features have stable IDs and JSON properties. Re-alignment invalidates
confirmation/review but never moves existing geographic drawings.

- `onChange(document)` mirrors committed drafts; it is not a save receipt.
- `onSave(envelope)` accepts only confirmed, reviewed, valid features. Persist
  `envelope.features` and its source/alignment provenance. Replace only features
  belonging to `envelope.documentId`; omitted IDs represent deletions in that scope.
- `onSaveDraft({ requestId, document })` can persist unfinished work. Image bytes
  remain the host's responsibility.

Resolve save callbacks only after storage accepts the snapshot; reject on failure.
Retries of the same revision/save kind reuse the request ID. An older save cannot
mark newer edits saved. Draft acknowledgements and accepted-feature
acknowledgements are separate. Neither feature saving nor draft saving requires a
raster export. See the
[persistence guide](https://github.com/tobilg/georeferencing/blob/main/packages/documentation/guides/lifecycle-and-saving.md).

## Optional exports and interchange

Register descriptors through `ControllerOptions.exports` or `setExportFormats`.
`controller.export(id)` returns the processed document snapshot and downloadable
files. `exportRaster()` requires the GeoTIFF plugin; `exportWorldFile()` requires
the world-file plugin. Export configuration stays outside session JSON.

Core provides `parseSession`, `importPoints` and `featuresInCrs` for session
validation, point imports and geographic feature conversion. Export-only serializers
`exportPoints`, `accuracyReport` and `worldFile` are available from
`@georeferencing/plugins/serializers`. Update imports from earlier workspace builds
to that entry point; core no longer exports those three functions.
QGIS `.points` uses negated source y and cannot preserve session IDs/provenance;
JSON sessions preserve the full document. Non-geographic feature output uses an
explicit `ProjectedFeatureCollection`, not mislabeled RFC 7946 GeoJSON. See the
[plugins README](https://github.com/tobilg/georeferencing/blob/main/packages/plugins/README.md)
for encoding, file lists, cancellation and format-specific limits.

## Workers, projections and budgets

With Vite, configure ES module workers:

```ts
export default { worker: { format: "es" } };
```

The default worker URL is relative to the installed module. For static asset
placement, copy `dist/engine/worker.js`, its adjacent legal notice and
`dist/licenses` to your distribution, then set `workerUrl`. A custom
`workerFactory` must return a fresh worker per operation. Worker instances are
terminated on completion or cancellation. No WASM, CDN or cross-origin isolation
is required. CSP must allow the worker URL and blob image previews.

```ts
import { createJobScheduler, createWorkerEngine } from "@georeferencing/core/engine";
import { registerProjections } from "@georeferencing/core/openlayers";

const definitions = {
  "EPSG:25832": "+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs +type=crs",
};
registerProjections(definitions);
export const engine = createWorkerEngine({
  definitions,
  workerUrl: "/my-app/assets/georeferencing-worker.js",
  scheduler: createJobScheduler(1),
  limits: { maxInputPixels: 24_000_000, maxOutputPixels: 24_000_000 },
});
```

Use projection definitions appropriate to your own data. EPSG:4326 and EPSG:3857
are built in; other identifiers do not automatically download definitions. Pass
identical definitions and any licensed NTv2 `datumGrids` to the engine and map
binding. Share one scheduler across engines when bounding total concurrent workers.

| Default limit | Value |
| --- | ---: |
| Compressed image size | 26,214,400 bytes (25 MiB) |
| Input pixels | 24,000,000 |
| Output pixels | 24,000,000 |
| Estimated memory reservation | 768 MiB |
| Longest preview dimension | 768 pixels |
| Enabled control points | 128 |

Compressed bytes do not bound decoded memory. Header inspection checks dimensions
before decoding, and output allocation is budgeted. These are allocation estimates,
not browser process RSS guarantees. Original bytes are retained for final export;
large rasters still require full source/output buffers.

Supported inputs are ordinary 8-bit nonanimated PNG, grayscale/RGB JPEG, static WebP, and
single-page orientation-1 chunky unsigned 8-bit grayscale/RGB/unassociated-RGBA
TIFF with supported compression. All eight JPEG/PNG/WebP EXIF orientations are normalized.
Unsupported scientific sample types, multipage layouts and geographic domains fail
explicitly. Existing GeoTIFF placement is a hint, not an accepted alignment.

## Troubleshooting and license

| Symptom | Check |
| --- | --- |
| Image replacement returns `false` | Dirty-work guard choice, supplied save callback and snapshot error |
| Fit/confirmation is unavailable | Current image bytes, enabled pairs, rank/domain diagnostics and matching revision |
| Export is disabled | An explicitly configured plugin with the requested ID |
| Worker fails or cannot load | Deployment base, emitted asset URL, CSP and fresh-worker factory |
| Wrong reference placement | Declared source/working/map CRSs, definitions and WFS wire axes |
| Memory/output budget exceeded | Input dimensions, output resolution/bounds and configured limits |

MIT licensed. Bundled third-party notices are included under `dist/licenses`;
retain them when redistributing worker assets. Public TypeDoc comments ship in
`.d.ts` files for editor help and are published as the
[API documentation](https://georeferencing-api-docs.gh.tobilg.com). Source, issues and contribution notes are in the
[GitHub repository](https://github.com/tobilg/georeferencing).
