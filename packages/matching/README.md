# @georeferencing/matching

Finds where a scanned or exported plan lies on a reference map, and proposes control
points for it.

Matching runs locally, in a browser Web Worker or a Node worker thread, with a
bundled OpenCV WebAssembly build. No server, CDN or telemetry is involved. The
package ships no UI: your application owns the controls, progress display,
candidate previews and the decision to apply a match. Applications that never call
matching never load it or OpenCV.

## How it works

1. **Capture the search area.** A _reference snapshot_ holds the pixels of the map
   area to search, plus where they lie on the map: CRS, extent and pixel-to-map
   transform. Providers fetch it from a WMS server or render it from map layers.
2. **Match.** A matcher compares the plan (the _query_) with the snapshot and
   returns ranked _candidates_: possible placements with the evidence for each.
3. **Review and apply.** The user inspects the candidates. Only on explicit
   acceptance does `applyCandidate` add control points to the editor, as one
   undoable edit.

## Install

```sh
npm install @georeferencing/core @georeferencing/matching
```

Use the same version of both packages. A reference provider additionally needs the
map library you already use: `ol@10`, `leaflet@1` (with `@types/leaflet` for
TypeScript) or `maplibre-gl@6`.

## Entry points

| Import | Use it for |
| --- | --- |
| `@georeferencing/matching` | Types, snapshots, WMS acquisition, coordinate helpers and applying a candidate |
| `@georeferencing/matching/browser` | `createBrowserMatcher()` and `decodeReferenceImage()` |
| `@georeferencing/matching/node` | `createNodeMatcher()` |
| `@georeferencing/matching/openlayers` | Snapshots from an OpenLayers WMS source or loaded vector layers |
| `@georeferencing/matching/leaflet` | Snapshots from an `L.tileLayer.wms` layer |
| `@georeferencing/matching/maplibre` | Snapshots from a WMS-backed MapLibre raster layer |
| `/worker`, `/opencv.js`, `/opencv.wasm` | Worker and WASM assets, for hosts that copy them manually |

The root entry never starts a worker or loads WASM, React or a map library. The
[matching guide](https://github.com/tobilg/georeferencing/blob/main/packages/documentation/guides/matching.md)
has compiled examples for every entry; the generated API reference documents each
option, default, coordinate space and error.

## Quick start: browser

```ts
import {
  createBrowserMatcher,
  decodeReferenceImage,
} from "@georeferencing/matching/browser";
import {
  createOpenLayersProvider,
  openLayersSelection,
} from "@georeferencing/matching/openlayers";

// 1. Capture the visible map area from a WMS layer the map already shows.
const provider = createOpenLayersProvider([
  { id: "ortho", layer: wmsLayer, revision: "2026" },
]);
const reference = await provider.acquire(openLayersSelection(map, ["ortho"]));

// 2. Match the plan that is loaded in the editor.
const query = await decodeReferenceImage(await controller.getNormalizedImage());
const matcher = createBrowserMatcher();
try {
  const result = await matcher.match(
    { query, reference },
    { onProgress: ({ stage }) => console.log(stage) },
  );
  console.log(result.status, result.candidates);
} finally {
  matcher.dispose();
}
```

With Leaflet or MapLibre only step 1 changes; see [Reference sources](#reference-sources).
For repeated searches, keep one matcher per application view and dispose it when
the view is destroyed.

## Quick start: Node

`@georeferencing/matching/node` provides one function, `createNodeMatcher()`. It
runs the same engine as the browser on a worker thread, so a long job does not
block the event loop and an abort can stop it at any time. Node has no image
decoder or map renderer, so you supply both inputs as pixels:

- **The plan:** packed RGBA from any decoder, with EXIF orientation applied.
- **The search area:** fetched with `createWmsProvider`, which works with Node's
  built-in `fetch`, or a georeferenced image you already have, wrapped with
  `createSnapshot`.

```ts
import sharp from "sharp"; // any decoder works
import {
  createWmsProvider,
  transform,
  type PixelImage,
} from "@georeferencing/matching";
import { createNodeMatcher } from "@georeferencing/matching/node";

async function decode(input: Blob | Uint8Array): Promise<PixelImage> {
  const bytes =
    input instanceof Blob ? new Uint8Array(await input.arrayBuffer()) : input;
  const { data, info } = await sharp(bytes)
    .rotate() // apply EXIF orientation
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

const query = await decode(planFileBytes);
const reference = await createWmsProvider({
  url: "https://example.org/wms",
  source: { id: "orthophoto", revision: "2026", layers: ["ortho"] },
  decode,
}).acquire({
  extent: [565000, 5930000, 567000, 5932000],
  crs: "EPSG:25832",
  resolution: 0.5, // map units per reference pixel
  layers: ["ortho"],
});

const matcher = createNodeMatcher();
try {
  const result = await matcher.match({ query, reference });
  const best = result.candidates[0];
  if (result.status === "matched" && best) {
    // Plan pixel → reference pixel (candidate) → map coordinates (snapshot).
    const toMap = (p: [number, number]) =>
      transform(reference.pixelToMap, transform(best.transform, p));
    console.log(toMap([0, 0]), toMap([query.width, query.height]));
  }
} finally {
  matcher.dispose();
}
```

To turn the match into control points instead, pass it to `applyCandidate` with a
core `GeoreferencerController`, which also runs in Node. Typical uses are batch
georeferencing on a server, preprocessing pipelines and automated checks.

## Reference sources

| Map library | Built-in acquisition | Everything else |
| --- | --- | --- |
| OpenLayers (`/openlayers`) | One `ImageWMS`/`TileWMS` source, or selected loaded vector/WFS layers rendered in an isolated north-up map | Host provider |
| Leaflet (`/leaflet`) | One `L.tileLayer.wms` layer | Host provider |
| MapLibre (`/maplibre`) | One raster layer whose source tiles are WMS GetMap URLs with `{bbox-epsg-3857}` | Host provider; vector tiles are not captured |

Every WMS path requests fresh images of exactly the selected area from the server,
using the layer's own layers, styles, version, time, filters and vendor parameters.
None reads the rendered map, so the layer may be hidden. Each entry also has a
helper that turns the current view into a selection:

```ts
import {
  createLeafletProvider,
  leafletSelection,
} from "@georeferencing/matching/leaflet";
import {
  createMapLibreProvider,
  mapLibreSelection,
} from "@georeferencing/matching/maplibre";

// Leaflet: the selection uses the map's CRS.
const fromLeaflet = createLeafletProvider([
  { id: "ortho", layer: leafletWmsLayer, revision: "2026" },
]);
await fromLeaflet.acquire(leafletSelection(leafletMap, ["ortho"]));

// MapLibre: `layer` is a style layer ID; the selection is EPSG:3857 and needs
// zero pitch.
const fromMapLibre = createMapLibreProvider([
  { id: "ortho", map: maplibreMap, layer: "ortho-layer", revision: "2026" },
]);
await fromMapLibre.acquire(mapLibreSelection(maplibreMap, ["ortho"]));
```

The Leaflet and MapLibre entries do not import their library at runtime.

**Any WMS server.** `createWmsProvider` takes an endpoint, a `decode` function and an
optional `request` function for authentication. It requests bounded tiles inside
the selection, rounds dimensions up and records the exact pixel-to-map mapping, and
never substitutes another zoom level. It handles the latitude-first axis order of
WMS 1.3 EPSG:4326; set `axisOrder` for other latitude-first CRSs. Requests run in
sequence and can be cancelled. Service, CORS and loading failures reject explicitly.

**Credentials** belong in the `request` closure, never in the source identity.
Known credential parameter names are removed from snapshot metadata.

**Other sources**, such as caller-rendered WFS or another raster, implement
`ReferenceProvider` and build the result with `createSnapshot`. The snapshot must
keep the selected extent, CRS, exact pixel-to-map mapping, source and style
revision, and mark missing data. It copies the pixels and freezes its metadata, so
it never keeps live map references.

**OpenLayers vector capture** copies the currently loaded features and styles; it
never runs feature loaders, so wait for WFS loading first. Style callbacks must be
deterministic. The capture renders at pixel ratio 1, excludes editor overlays,
needs an extent aligned to the resolution grid and is capped at 8 MP and 8,192
pixels per side. Mixed WMS and vector selections need a host provider.

## Reviewing and applying a match

Build the review UI with the framework and map you already use:

1. **Before acquiring**, capture `createApplicationToken(controller,
   configurationRevision)`. Your revision string must change whenever source data or
   styles, selected layers, extent, resolution, query region or matching options
   change.
2. **Acquire** a snapshot with a provider, and decode the query from
   `controller.getNormalizedImage(signal)`.
3. **Match** with an abort signal, and show progress. Cancel and discard results
   when the image, alignment or configuration changes.
4. **Present** the ranked candidates with their coverage and uncertainty.
   `footprint` and `overlap` are in reference pixels: draw them through
   `transform(snapshot.pixelToMap, point)`, or `densifyBoundary` for nonlinear
   mappings. Style the observed overlap differently from the extrapolated footprint.
5. **Apply** only on explicit acceptance:

```ts
import { applyCandidate, createApplicationToken } from "@georeferencing/matching";

const token = createApplicationToken(controller, configurationRevision);
// … acquire `reference`, run `result = await matcher.match(…)`, let the user pick
// `candidate` from `result.candidates` …
applyCandidate(controller, result, candidate, reference, token, {
  configurationRevision, // must still equal the token's revision
});
```

Application adds up to 16 spatially distributed points (`maxPoints`) with CRS and
source provenance, within the core point limit. It fits and validates the full
image first and rejects stale results with `STALE`. By default it merges with the
existing points and keeps the document's fit model; offer `mode: "replace"` or
`model: "candidate"` (adopt the matched model) only as explicit user choices.
Then continue with the usual alignment review and export.

The demo's
[MatchingPanel](https://github.com/tobilg/georeferencing/blob/main/packages/demo/MatchingPanel.tsx)
and [overlay renderer](https://github.com/tobilg/georeferencing/blob/main/packages/demo/matching-overlays.ts)
show one way to build this; they are examples, not exports. The React editor's
optional `matchingPanel` slot accepts your own content. To try it, run `pnpm dev`
in the repository, choose OpenLayers, then **Find points automatically** and
**Load example image**.

## Understanding results

| Status | Meaning |
| --- | --- |
| `matched` | The best validated candidate is clearly ahead of the others |
| `ambiguous` | Several validated candidates have similar scores; let the user inspect each |
| `not-found` | Not enough evidence; this does not prove the plan is absent |

A candidate needs at least 12 independent correspondences, but that alone is not
enough. Collinear points, projective poles, mirrored or collapsed footprints,
repeated glyphs, and weak or unstable fits are rejected. Repeated copies of a plan
in the reference all survive as separate candidates.

| Candidate field | Meaning |
| --- | --- |
| `score` | Ranking measure (`evidence/1`), **not a probability**; a strong partial candidate can outrank a weak complete one |
| `transform` | 3×3 matrix from plan pixels to reference pixels |
| `footprint`, `overlap` | The plan's outline, and its part inside the search area, in reference pixels |
| `extentStatus` | `complete`, or `partial` when the plan extends beyond the search area (one-pixel tolerance) |
| `overlapFraction` | Share of the plan region inside the search area |
| `referenceDataCoverage` | Share of the plan region with actual source pixels behind it |
| `supportCoverage` | Area covered by the matched points, relative to the observable overlap |
| `independentInliers`, `medianError`, `p95Error` | Amount of evidence, and residuals in reference pixels (not survey accuracy) |

The three coverage values measure different things and are not interchangeable.
Matching independently drawn styles is never universally reliable: keep a manual
review step.

## Choose a detector

`options.detector` selects how features are found and compared. SIFT is the
default; AKAZE is used only when a request sets `detector: "akaze"`. Both ship in
the same WASM file, run the same search and acceptance checks, and are covered by
the same tests. The detector changes how much evidence is found and how fast,
never what counts as a valid match.

| | SIFT (default) | AKAZE |
| --- | --- | --- |
| Descriptor | 128 floats, L2 distance | 486 bits, Hamming distance |
| Benchmark plans, first match | 1.1–1.9 s | 0.3–1.0 s |
| Same reference again (cached features) | about 0.7 s | about 0.45 s |
| Small plan in a 5000×5000 reference | about 17 s | about 11 s |
| Peak WASM heap | about 240 MiB | about 96 MiB |
| Benchmark plans matched | 8 of 8 | 6 of 8 |
| Corner error when matched | 0.05–1.2 px | 0.02–1.0 px |

Times are single-worker Node measurements on an Apple M2; compare the ratios rather
than the absolute values. The up-front memory budget check is the same for both.

**Use SIFT** when one reliable attempt matters more than speed, especially when:

- the plan's scale differs noticeably from the reference, for example a scan at a
  lower resolution than the reference tiles;
- annotations, stamps, coloured markup or handwriting cover the linework;
- the plan only partly overlaps the search area, or a small plan is searched in a
  large area.

**Use AKAZE** when speed or memory matters and the input is favourable:

- interactive re-runs while a user adjusts the search area, batch jobs over many
  plans, or memory-constrained browsers;
- clean plans at roughly the reference's scale, such as exports from the same CAD
  or GIS source;
- when you can retry with SIFT after a `not-found`.

AKAZE finds fewer matching points on hard input. When that is too few it returns
`not-found`, never a different placement. A fallback keeps most of its speed:

```ts
let result = await matcher.match({
  ...request,
  options: { detector: "akaze" },
});
if (result.status === "not-found")
  result = await matcher.match({ ...request, options: { detector: "sift" } });
```

A matcher caches the reference features of its last request only, keyed by
detector and options. If you alternate detectors repeatedly, keep one matcher per
detector.

## Pixels and coordinates

- Images are packed RGBA without row padding. Pixel coordinates are image edges:
  top-left `(0, 0)`, Y down, first pixel centre `(0.5, 0.5)`.
- `queryRegion` optionally limits matching to a rectangle of the plan, in the same
  coordinates. It defines the plan footprint.
- Transparent pixels count as missing data; white paper is valid data. Tiles with
  `valid: false` also mark missing data. Tiles partition the raster, and their
  seams do not affect matching.
- `profile: "technical-plan"` normalizes contrast; `"generic"` keeps it.
  `suppressColor` ignores strongly coloured features; leave it off when colour
  carries detail.
- `pixelToMap` is a row-major 3×3 matrix. The default is the exact north-up mapping
  of `extent`; supply the exact matrix for rotated rasters. For a nonlinear mapping,
  pass a `pixelToMap` callback to `applyCandidate` and draw overlays with the same
  mapping.
- Snapshots and requests are copied, never transferred, so caller buffers stay
  usable. Do not mutate a snapshot's pixel data.

## Limits and memory

| Limit | Default |
| --- | --- |
| Plan image (`maxQueryPixels`) | 25 MP |
| Reference (`maxReferencePixels`) | 32 MP, at most 4,096 tiles |
| Memory reservation (`maxMemoryBytes`) | 1 GiB, enough for both at once |
| Features (`maxFeatures`, `featuresPerTile`) | 24,000 per image, 1,600 per processing window |
| Candidates (`maxCandidates`) | 5 |
| Image side | 32,768 pixels at most |
| WASM heap | 512 MiB hard maximum |

The memory estimate covers input copies, descriptors and the WASM heap, not browser,
GPU or decoder memory. Raising it does not provision memory. One reference feature
cache is kept per matcher and cleared on disposal.

When the core worker engine should accept plans this large, create it with
`MATCHING_CORE_LIMITS` (25 MP input, 64 MiB encoded, 1 GiB memory). Core's separate
24 MP **output** limit is unchanged; raise it only if your export fits in memory.

## Cancellation, lifecycle and errors

A matcher runs one job at a time. Aborting terminates its worker, even inside
WebAssembly, and the next job starts a fresh one. A second concurrent job rejects
with `BUSY`; any job after `dispose()` rejects with `DISPOSED`. Only data crosses
the worker boundary, never callbacks, signals or map objects.

| Error | What to do |
| --- | --- |
| `INPUT` | Fix the image buffers, query region, selection or options |
| `BUDGET` | Reduce the image or search area, or set a measured memory budget; applying also needs free point slots |
| `SOURCE` | Fix reference loading, credentials, CORS, rendering or decoding; do not report it as not-found |
| `BACKEND` | Check worker and WASM URLs, CSP and asset versions |
| `BUSY` | Wait for or abort the current job |
| `DISPOSED` | Create a new matcher |
| `STALE` | Discard the old review and match the current inputs again |
| `GEOMETRY` | Reject the invalid mapping and keep the manual work |
| `AbortError` | The job was cancelled; do not show it as a failure |

## Deployment

- **Vite** emits the module worker and the local `.wasm` file automatically.
- **Other bundlers:** pass `workerFactory: () => new Worker(workerUrl, { type:
  "module" })` and optionally `wasmUrl` to `createBrowserMatcher`. The factory must
  return a new dedicated worker each time; never a shared one.
- **Copying assets manually:** use the `/worker`, `/opencv.js` and `/opencv.wasm`
  exports and keep the worker's relative `vendor/opencv.js` and `vendor/opencv.wasm`
  paths.
- **Serving:** `application/wasm`, same-origin assets and CSP
  `script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'`. Neither SIMD nor
  cross-origin isolation is required.
- **Node** loads the assets from the installed package; a `wasmUrl` override must be
  an absolute local file path.

## Backend and licences

The backend is a trimmed, single-threaded, scalar OpenCV 4.12.0 WASM build
(Emscripten 6.0.8, about 4.4 MB uncompressed). On startup it checks SIFT, AKAZE,
BFMatcher, findHomography and perspectiveTransform.
`dist/licenses/opencv-provenance.json` records exact hashes and build flags; the
Apache, BSD and third-party notices ship with the assets. Rebuild it with
`bash scripts/matching/build-opencv.sh` in the repository.

## Development

In the repository: `pnpm test:matching`, `pnpm test:browser`,
`pnpm test:consumer` and `pnpm release:check`. `pnpm benchmark:matching` needs
private plan images, which stay git-ignored under `plans/` and `artifacts/`; the
synthetic fixtures are deterministic and MIT-licensed. Benchmark results are fixture
measurements, not accuracy guarantees.
