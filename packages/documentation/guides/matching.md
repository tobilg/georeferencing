---
group: Guides
title: Automatic plan matching
---

# Automatic plan matching

`@georeferencing/matching` locates normalized image pixels inside a supplied
reference snapshot. It runs locally in browser workers or Node worker threads.
It ships algorithms, typed contracts, worker executors, reference acquisition and
explicit controller-application helpers. **It ships no UI components, React entry
point, styles, or candidate-overlay renderer.** Build the workflow your application
needs with the framework and map renderer you already use.

## Install and choose an entry point

```sh
pnpm add @georeferencing/core @georeferencing/matching
# Only for the optional OpenLayers reference provider:
pnpm add ol@10
```

Keep the core and matching versions aligned. Import the executor for your runtime;
importing the shared root does not start workers or load OpenCV, React or a map
library. No external processing service, telemetry or third-party CDN is required.

| API | Purpose |
| --- | --- |
| {@link "@georeferencing/matching"} | Shared contracts, snapshots, WMS acquisition, numerical helpers and explicit application |
| {@link "@georeferencing/matching/browser"} | Browser worker factory and normalized-blob decoder |
| {@link "@georeferencing/matching/node"} | Node worker-thread factory |
| {@link "@georeferencing/matching/openlayers"} | Optional acquisition from configured WMS or loaded vector layers |

The API pages document individual option defaults, coordinate spaces, ownership,
errors and disposal. The examples below are compiled against public package exports.

## Run matching in a browser

Supply packed, EXIF-normalized RGBA pixels for the original query and an immutable
reference snapshot. A request never applies control points automatically.

{@includeCode ../examples/matching.ts}

This one-shot example disposes its worker in `finally`. For repeated searches,
keep one matcher per application view and dispose it when the view is destroyed.
Only one job may be active on an instance; abort an obsolete job before starting
another. Successful requests reuse initialization and a bounded reference cache.

## Run matching in Node

Node callers choose their own decoder and normalize orientation before supplying
pixels. No DOM, React, map renderer or native OpenCV installation is needed. Browser
map rendering is outside Node parity; the pixel contract and matching semantics
are shared.

{@includeCode ../examples/matching-node.ts}

The example explicitly reserves 1 GiB for a suitably provisioned host. Use a smaller
query/reference or limits appropriate to your environment; raising the budget does
not provision physical memory.

## Acquire the selected reference area

`createWmsProvider` accepts a host endpoint, request function and decoder. It
preserves WMS layers/styles/filters/time, selected extent and actual resolution,
assembles bounded tiles inside the selected area, and handles WMS 1.3 EPSG:4326
latitude/longitude order. Set `axisOrder` for other latitude-first CRSs. Noninteger
extent/resolution ratios are rounded up in dimensions and the actual pixel-to-map
mapping is recorded; there is no substitution of a different zoom level. Requests
are sequential and cancellable. Service, CORS and loading failures are explicit.
Credentials belong in host request closures, never source identity/provenance.
Known credential parameter names are removed from snapshot metadata.

Any provider can supply rendered WFS pixels. Node parity covers matching and the
snapshot contract, not browser style rendering. Node can decode WMS responses using
its own decoder.

| Adapter | Native matching reference | Host-provider route |
| --- | --- | --- |
| OpenLayers (`/openlayers`) | One configured WMS source, or selected loaded vector/WFS layers rendered in an isolated north-up map | Yes |
| MapLibre | No built-in selected-layer snapshot; existing PDF capture is insufficient | Yes; host renders an exact unpitched snapshot |
| Leaflet | No built-in selected-layer readback | Yes; WMS acquisition or host-rendered pixels |

OpenLayers vector capture copies currently loaded features and style configuration;
wait for host WFS loading before acquisition. Style callbacks must be deterministic
and independent of mutable host state. No feature loader is triggered on the copy.
Vector capture requires an extent aligned to the resolution grid, is capped at
8 MP/8192 pixels per side, uses pixel ratio 1, and excludes editor overlays.
Unknown raster renderers and mixed WMS/vector compositions require a host provider.


For a browser WMS integration, inject transport and decode functions. Acquisition
runs before matching, so measure its duration separately from algorithm diagnostics.

{@includeCode ../examples/matching-reference.ts}

For caller-rendered WFS or another raster source, implement
{@link "@georeferencing/matching".ReferenceProvider} and create its result with
{@link "@georeferencing/matching".createSnapshot}. The provider must preserve the
selected extent, CRS, exact pixel-to-map mapping, source/style revision, and missing
source data. Capture selected reference content without UI or candidate overlays.
A snapshot copies bytes and freezes metadata; it does not keep live map references.

## Data and coordinates

All public pixel coordinates use normalized full-image edges: top-left `(0,0)`,
Y down, first centre `(0.5,0.5)`. OpenCV centres, crops and resizing are converted
explicitly. `queryRegion` is an optional rectangle in that same coordinate space.
It defines the plan footprint; feature/colour exclusion never changes that region.
Transparent pixels are composited over white and excluded from evidence. White
paper remains valid data. `technical-plan` uses separate min/max contrast
normalization; `generic` retains grayscale contrast. Optional `suppressColor`
excludes strongly coloured features; leave it disabled when colour carries detail.

Buffers are packed RGBA without row padding. Snapshot creation clones pixels and
metadata, and executors structured-clone requests without detaching caller buffers.
Do not mutate snapshot byte views. Snapshot metadata is frozen; map navigation does
not change it. All tiles partition the same raster with integer offsets; explicit
`valid: false` tiles or alpha-zero pixels represent missing data. Internal tile
edges do not define coverage. Extraction windows read across acquisition seams.

`pixelToMap` is a row-major 3×3 matrix applied to column vectors. The default is an
exact north-up edge mapping from `extent`; supply the exact matrix for rotated
rasters. Nonlinear host mappings stay outside worker messages: provide a
`pixelToMap` callback to `applyCandidate` and a matching host overlay renderer.
No pixel polygon is advertised as longitude/latitude GeoJSON. CRS conversion and
full-image domain validation on application use the existing core registry/fitter.

## Choose a detector

`options.detector` selects how features are found and compared. SIFT is the default;
AKAZE is used only when a request sets `detector: "akaze"`. Both detectors ship in
the same WASM file, run the same search and the same acceptance checks, and are
covered by the same tests. The detector changes how much evidence is found and how
fast, never what counts as a valid match.

| | SIFT (default) | AKAZE |
| --- | --- | --- |
| Descriptor | 128 floats, L2 distance | 486 bits, Hamming distance |
| Benchmark plans, first match | 1.1–1.9 s | 0.3–1.0 s |
| Same reference again (cached features) | about 0.7 s | about 0.45 s |
| Small plan in a 5000×5000 reference | about 17 s | about 11 s |
| Peak WASM heap | about 240 MiB | about 96 MiB |
| Benchmark plans matched | 8 of 8 | 6 of 8 |
| Corner error when matched | 0.05–1.2 px | 0.02–1.0 px |

Times are single-worker Node measurements on an Apple M2 from the repository's
matching benchmark; compare the ratios rather than the absolute values. The up-front
memory budget check is the same for both detectors.

**Use SIFT** when one reliable attempt matters more than speed, and especially when:

- the plan's scale differs noticeably from the reference, for example a scan at a
  lower resolution than the reference tiles;
- annotations, stamps, coloured markup or handwriting cover the linework;
- the plan only partly overlaps the search area, or a small plan is searched in a
  large area. More matched points leave more margin over the acceptance checks.

**Use AKAZE** when speed or memory matters and the input is favourable:

- interactive re-runs while a user adjusts the search area, batch jobs over many
  plans, or memory-constrained browsers;
- clean plans at roughly the reference's scale, such as exports from the same CAD or
  GIS source, or scans resampled to the reference resolution;
- when you can retry with SIFT after a `not-found`.

AKAZE finds fewer matching points on hard input. When that is too few, it returns
`not-found` rather than a different placement: in the benchmark it misses the plan
scaled to 65% and the warped, heavily annotated plan, which SIFT both matches. A
fallback keeps most of AKAZE's speed:

```ts
let result = await matcher.match({ ...request, options: { detector: "akaze" } });
if (result.status === "not-found")
  result = await matcher.match({ ...request, options: { detector: "sift" } });
```

A matcher caches the reference features of its last request only, keyed by detector
and options. Alternating detectors on one matcher therefore extracts the reference
again on every switch; keep one matcher per detector if you alternate repeatedly.

## Results and acceptance

Candidates are ordered by independent support, its spatial distribution,
distinctiveness, residuals, split-fit stability and structural agreement. Score
version `evidence/1` is a ranking measure, **not a probability**. A stronger partial
candidate can outrank a weaker complete one. Repeated reference copies survive
candidate generation; duplicate transforms are merged. Repetitive query glyphs,
collinearity, poles, mirrored or collapsed footprints, weak and unstable fits are rejected.
At least 12 independent correspondences are required; this alone is insufficient.

- `matched`: the top validated candidate has a sufficient score gap.
- `ambiguous`: validated alternatives have similar scores; inspect each one.
- `not-found`: insufficient evidence, not proof that the plan is absent.

`overlapFraction` is the area of the selected **query** region inside the search
area, computed by inverse mapping the clipped footprint. `referenceDataCoverage`
separately measures available source pixels as a fraction of the full query region
(alpha coverage uses a deterministic grid). `supportCoverage` is the correspondence
hull divided by observable overlap. These three quantities are not interchangeable.
`extentStatus` uses a one-reference-pixel boundary tolerance; the unrounded overlap
fraction is still returned. Hosts should distinguish extrapolation beyond the
observed overlap when rendering footprints. Residuals are in original reference pixels, not survey accuracy.

## Build your application's matching UI

Use the headless APIs with your preferred UI framework. The package does not
provide a React entry point or stylesheet. Reference acquisition is separate from
matching; the optional OpenLayers entry captures pixels and does not draw results.

1. Capture a `createApplicationToken(controller, configurationRevision)` before
   acquisition. The host revision must cover source data/styles, selected layers,
   extent, resolution, query region and matching configuration.
2. Acquire a `ReferenceSnapshot` with a provider. Decode the query from
   `controller.getNormalizedImage(signal)` with `decodeReferenceImage` in a browser,
   or supply normalized RGBA from your own decoder.
3. Call `matcher.match`, pass an abort signal and render its progress in your UI.
   Cancel and invalidate results when the image, alignment or host configuration
   changes. Keep an application job/generation ID to discard late acquisition work.
4. Present ranked candidates and their coverage/uncertainty. `footprint` and
   `overlap` are reference pixels, so map them with `transform(snapshot.pixelToMap,
   point)` and your map projection. For nonlinear mappings use `densifyBoundary`.
   Style observed overlap separately from extrapolated footprint in your own map.
5. Only on explicit user acceptance, call `applyCandidate` with the original result,
   selected candidate object, snapshot/token and current configuration revision.
   The default merges manual points and keeps the document's fit model; offer
   replacement, or `model: "candidate"` to adopt the matched model, only by explicit choice.

Application is one undoable controller edit, with up to 16 distributed proposed
points by default, explicit CRS/source provenance and the core control-point cap.
It fits/validates the full image before mutation, and rejects stale results. Continue
through the existing alignment review and export/save flow after adding points.

The private demo's [MatchingPanel](https://github.com/tobilg/georeferencing/blob/main/packages/demo/MatchingPanel.tsx)
and [overlay renderer](https://github.com/tobilg/georeferencing/blob/main/packages/demo/matching-overlays.ts)
are examples for hosts to adapt, not library exports. The React editor's optional
`matchingPanel` slot accepts host content; it does not import matching.
Run `pnpm dev`, choose OpenLayers, then **Find points automatically** and **Load
example image**. The existing four steps remain unchanged. The demo uses
project-owned generated marks; use your actual reference plan layers in your app.


The following browser example separates preparing a result from accepting it.
Keep the original token, snapshot and result together while the user reviews them.

{@includeCode ../examples/matching-application.ts}

The surrounding application owns these lifecycle rules:

- Show acquisition progress before algorithm stages begin. `MatchProgress.total`
  describes the current stage; zero means indeterminate, not completed.
- Pass the same `AbortSignal` to acquisition and matching. Invalidate review state
  and increment a host job ID whenever selection, image, alignment or source
  configuration changes. Ignore late results from a previous job even if a custom
  provider fails to stop immediately after cancellation.
- Show `matched`, `ambiguous` and `not-found` distinctly. Let the user inspect each
  candidate, observed overlap, unavailable source data and extrapolation. A score
  is a ranking measure, not a correctness probability.
- Invoke `applyReviewedLocation` only from an explicit acceptance action with the
  current configuration revision. Do not create a fresh token at acceptance time.
  The revision guard rejects edits made while results were being reviewed.
- Abort outstanding work, clear owned overlays and call `matcher.dispose()` on
  unmount/shutdown. Starting matching and displaying results do not alter points.

## Resources and lifecycle

Default limits: 25 MP query, 32 MP reference, 1 GiB reservation (enough for both at once), 24,000 features
per image, 1,600 features per window, 1,024-pixel coarse edge and processing tiles
with 96-pixel internal halos, five candidates, one active job. Dimensions are capped
at 32,768 per side; references at 4,096 acquisition tiles. The WASM heap has a hard
512 MiB maximum; live image matrices and descriptors are deleted after each unit.
One content-checked reference feature cache is retained, and reset on disposal.
The estimate includes input copies, descriptor storage and the capped WASM heap;
it is not a guarantee about browser/GPU/host decoder memory.

A 5,000×5,000 query was exercised on a 16 GiB Apple M2 with an explicit 1 GiB matching
reservation. Use `MATCHING_CORE_LIMITS` when creating the existing core worker engine
(25 MP input, 64 MiB encoded bytes, 1 GiB memory). Matching consumes decoded pixels;
the caller enforces its encoded-byte limit before decoding. Core's default 24 MP
**output** limit remains separate; increase only when the intended export fits the
host's output memory budget. The original manual defaults are unchanged.

Abort terminates the worker even during synchronous WASM and makes late messages
irrelevant. The next request creates a fresh worker. Disposal is idempotent;
requests afterward reject `DISPOSED`. Concurrent requests reject `BUSY`. Errors use
`INPUT`, `BUDGET`, `BACKEND`, `SOURCE`, `STALE`, or `GEOMETRY`; cancellation is an
`AbortError`. Worker messages carry a job ID and serialized progress/result/error;
callbacks, signals, DOM nodes and map objects are never posted.

## Backend and reproduction

The shipped artifact is trimmed OpenCV 4.12.0, built with Emscripten 6.0.8, single
threaded scalar WASM. Runtime startup checks SIFT, AKAZE, BFMatcher, findHomography
and perspectiveTransform. SIFT is the default; AKAZE is a supported alternative with
the trade-offs described under "Choose a detector". Detection is isolated in `features.ts`; executor/result contracts
do not depend on a detector. The local artifact is about 4.4 MB uncompressed; see
`dist/licenses/opencv-provenance.json` for exact hashes and flags. Build from source
with `bash scripts/matching/build-opencv.sh` in the repository. Required Apache,
BSD and third-party notices accompany the assets.

Repository validation: `pnpm test:matching`, `pnpm benchmark:matching` (requires
private local plans), `pnpm test:browser`, `pnpm test:consumer`, `pnpm release:check`.
Synthetic fixtures are deterministic MIT-licensed source. Private image files and
derived browser fixtures stay ignored under `plans/` and `artifacts/` and never ship.
Matching independently drawn styles is not universally reliable: preserve manual
review, and never interpret these fixture results as positional-accuracy guarantees.

## Failure handling

{@link "@georeferencing/matching".MatchingError} has a stable `code`. Decoder,
custom-provider and worker-creation errors can also propagate their native type.

| Code / error | Host response |
| --- | --- |
| `INPUT` | Correct image buffers, query region, selection or options before retrying |
| `BUDGET` | Reduce query/reference size or configure a measured suitable memory budget; application also needs free GCP slots |
| `SOURCE` | Fix reference loading, credentials, CORS, rendering or decoder failures; do not report these as not-found |
| `BACKEND` | Check packaged worker/WASM URLs, CSP and artifact compatibility |
| `BUSY` | Wait for or abort the current job before reusing the matcher |
| `DISPOSED` | Create a new matcher for a new owning view/session |
| `STALE` | Discard the old review and capture/match current inputs again |
| `GEOMETRY` | Reject the invalid mapping; preserve manual work |
| `AbortError` | Clear busy state for the cancelled job; do not display it as an algorithm failure |

## Worker assets and deployment

With Vite, the default browser module worker and local WASM are emitted as assets.
Other bundlers can supply `BrowserMatcherOptions.workerFactory` and `wasmUrl`.
The factory must create a new dedicated worker after an abort; the matcher owns
and terminates that worker. Never lend it a shared application worker.

Exports `/worker`, `/opencv.js` and `/opencv.wasm` support host-controlled copying.
When copying directly, retain the worker's `vendor/opencv.js` and
`vendor/opencv.wasm` relative paths. Serve WASM as `application/wasm`; use
same-origin assets and CSP `script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'`.
Neither SIMD nor cross-origin isolation is required by this build. Node resolves
assets beside the installed package; a `wasmUrl` override is an absolute local
filesystem path. Retain the bundled licenses/notices when redistributing assets.

See [workers and deployment](./workers-and-deployment.md) for shared core worker
configuration and the [matching API](../landing.md#entry-points) for entry points.
