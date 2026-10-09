Georeference images in the browser against an existing OpenLayers, MapLibre GL or
Leaflet map: load a local image, pair image points with map locations, fit one of seven
QGIS-style transformations, export a GeoTIFF and optionally draw features that your
application persists. Decoding, fitting and warping run in browser workers; no backend
is required.

[Live demo](https://georeferencing-demo.gh.tobilg.com) ·
[GitHub](https://github.com/tobilg/georeferencing) ·
[npm](https://www.npmjs.com/package/@georeferencing/core)

## Packages

| Package | Responsibility |
| --- | --- |
| {@link "@georeferencing/core" @georeferencing/core} | Documents, controller, transforms, projections, worker processing, reference data and the map-adapter contract; no map library or UI dependency |
| {@link "@georeferencing/plugins" @georeferencing/plugins} | Opt-in GeoTIFF, JPEG, PDF and data exports, each loaded only when used |
| {@link "@georeferencing/matching" @georeferencing/matching} | Optional local plan matching in browser workers and Node, with ranked review and explicit control-point application |
| {@link "@georeferencing/react" @georeferencing/react} | Ready-made editor, composable panels, subscription hook and scoped styles, for any map adapter |
| {@link "@georeferencing/openlayers" @georeferencing/openlayers} | OpenLayers adapter: any projection, WFS GML and borrowed host layers |
| {@link "@georeferencing/maplibre" @georeferencing/maplibre} | MapLibre GL JS adapter, drawing with Terra Draw |
| {@link "@georeferencing/leaflet" @georeferencing/leaflet} | Leaflet adapter, drawing with Terra Draw |

Install core, the adapter for your map library and, for the ready-made editor, React, all
in the same version. Every other package declares core as a peer dependency, so they
share your application's copy. Core enables no output formats by default; add only the
plugins your host needs. The [map adapters guide](./guides/map-adapters.md) compares the
adapters.

## Start with the guides

For an end-to-end host application, begin with the [integration guide](./guides/getting-started.md).

| Guide | What it covers |
| --- | --- |
| [Getting started](./guides/getting-started.md) | Installation, version alignment, a typed host-map integration and composable UI |
| [React and map libraries](./guides/react-integration.md) | Complete React integrations per map library, map lifecycle, session ownership, drawing and troubleshooting |
| [Using core without React](./guides/core-usage.md) | Controller, engine and adapter in plain TypeScript: state, the editing workflow, sessions and cleanup |
| [Map adapters](./guides/map-adapters.md) | Choosing and configuring the OpenLayers, MapLibre and Leaflet adapters, Terra Draw, custom adapters and migration |
| [Reference data](./guides/reference-data.md) | WFS axes/paging/authentication, borrowed layers, custom loaders, snapping and incomplete results |
| [Optional export plugins](./guides/export-plugins.md) | Format configuration, results and custom exporters |
| [Automatic plan matching](./guides/matching.md) | Reference snapshots, browser/Node matching, ranked alternatives, partial coverage and reviewed application |
| [Lifecycle and saving](./guides/lifecycle-and-saving.md) | Image replacement, guards, confirmation, review, immutable saves and resource ownership |
| [Coordinates and raster output](./guides/coordinates-and-output.md) | Pixel conventions, CRS spaces, models, residual formulas, resampling and output limits |
| [Workers, packaging and deployment](./guides/workers-and-deployment.md) | Lazy assets, budgets, cancellation, npm packaging, CSP and static hosting |
| [Capabilities and limits](./guides/capabilities.md) | Models, formats, resource budgets and integration boundaries |

## Entry points

The navigation is organized by package, then by import path. Each entry point's page
lists its classes, interfaces, functions and types.

| Import | Purpose |
| --- | --- |
| {@link "@georeferencing/core" @georeferencing/core} (also `/core`) | Serializable documents, controller, transforms, projections, geometry and interchange |
| {@link "@georeferencing/core/engine" @georeferencing/core/engine} | Lazy processing workers, raster helpers and scheduler |
| {@link "@georeferencing/core/map" @georeferencing/core/map} | Map-adapter contract, shared reference sources (WFS, GeoJSON, custom loaders) and helpers for adapter authors |
| {@link "@georeferencing/core/encoder-worker" @georeferencing/core/encoder-worker} | Protocol for custom raster codec workers |
| [`@georeferencing/core/worker`](./guides/workers-and-deployment.md#browser-assets) | Bundled processing-worker script |
| {@link "@georeferencing/plugins" @georeferencing/plugins} | All lazy format factories; prefer the per-format entries below |
| {@link "@georeferencing/plugins/geotiff" /geotiff}, {@link "@georeferencing/plugins/jpeg" /jpeg}, {@link "@georeferencing/plugins/pdf" /pdf}, {@link "@georeferencing/plugins/data" /data} | One export format family each |
| {@link "@georeferencing/plugins/tiff" @georeferencing/plugins/tiff} | Low-level TIFF encoding and validation |
| {@link "@georeferencing/plugins/report" @georeferencing/plugins/report} | Low-level PDF creation and optional map capture |
| {@link "@georeferencing/plugins/serializers" @georeferencing/plugins/serializers} | Pure QGIS points, world-file and accuracy-report serializers |
| [`@georeferencing/plugins/geotiff-worker`](./guides/workers-and-deployment.md#encoder-assets), [`/jpeg-worker`](./guides/workers-and-deployment.md#encoder-assets) | Bundled codec-worker scripts |
| {@link "@georeferencing/react" @georeferencing/react} | Ready-made editor, panels, types and subscription hook |
| {@link "@georeferencing/matching" @georeferencing/matching} | Shared pixel contracts, reference providers and explicit application |
| {@link "@georeferencing/matching/browser" /matching/browser}, {@link "@georeferencing/matching/node" /matching/node} | Lazy browser and Node worker executors |
| {@link "@georeferencing/matching/openlayers" /matching/openlayers} | Optional WMS/vector reference acquisition; hosts own matching UI and candidate rendering |
| {@link "@georeferencing/matching/leaflet" /matching/leaflet}, {@link "@georeferencing/matching/maplibre" /matching/maplibre} | Optional WMS reference acquisition from Leaflet and MapLibre layers |
| {@link "@georeferencing/openlayers" @georeferencing/openlayers} | `openLayers` adapter, `attachReferenceMap`, OpenLayers WFS/GML loading and map capture |
| {@link "@georeferencing/maplibre" @georeferencing/maplibre} | `maplibre` adapter, `attachMapLibre` and map capture |
| {@link "@georeferencing/leaflet" @georeferencing/leaflet} | `leaflet` adapter and `attachLeaflet` |
| [`@georeferencing/react/styles.css`](./guides/getting-started.md#attach-to-an-existing-map) | Optional scoped editor styles |

Worker script entries have no API of their own: load them as workers (the deployment
guide shows how), not as ordinary or SSR imports. API
signatures and guides keep source pixels, reference/working/map CRSs, raster output
and geographic features separate. The packages and this documentation are MIT
licensed; redistributing the library workers also requires their bundled notices.
