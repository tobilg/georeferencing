Georeference images in the browser against an existing OpenLayers map: load a local
image, pair image points with map locations, fit one of seven QGIS-style
transformations, export a GeoTIFF and optionally draw features that your application
persists. Decoding, fitting and warping run in browser workers; no backend is required.

[Live demo](https://georeferencing-demo.gh.tobilg.com) ·
[GitHub](https://github.com/tobilg/georeferencing) ·
[npm](https://www.npmjs.com/package/@georeferencing/core)

## Packages

| Package | Responsibility |
| --- | --- |
| {@link "@georeferencing/core" @georeferencing/core} | Documents, controller, transforms, projections, worker processing, reference data and the OpenLayers map binding |
| {@link "@georeferencing/plugins" @georeferencing/plugins} | Opt-in GeoTIFF, JPEG, PDF and data exports, each loaded only when used |
| {@link "@georeferencing/react" @georeferencing/react} | Ready-made editor, composable panels, subscription hook and scoped styles |

Install the same version of every `@georeferencing/*` package. Plugins and React
declare core as a peer dependency, so they share your application's copy. Core enables
no output formats by default; add only the plugins your host needs.

## Start with the guides

For an end-to-end host application, begin with the [integration guide](./guides/getting-started.md).

| Guide | What it covers |
| --- | --- |
| [Capabilities and limits](./guides/capabilities.md) | Models, formats, resource budgets and integration boundaries |
| [Getting started](./guides/getting-started.md) | Installation, version alignment, a typed host-map integration and composable UI |
| [Optional export plugins](./guides/export-plugins.md) | Format configuration, results and custom exporters |
| [Coordinates and raster output](./guides/coordinates-and-output.md) | Pixel conventions, CRS spaces, models, residual formulas, resampling and output limits |
| [Reference data](./guides/reference-data.md) | WFS axes/paging/authentication, borrowed layers, custom loaders, snapping and incomplete results |
| [Lifecycle and saving](./guides/lifecycle-and-saving.md) | Image replacement, guards, confirmation, review, immutable saves and resource ownership |
| [Workers, packaging and deployment](./guides/workers-and-deployment.md) | Lazy assets, budgets, cancellation, npm packaging, CSP and static hosting |

## Entry points

The navigation is organized by package, then by import path. Each entry point's page
lists its classes, interfaces, functions and types.

| Import | Purpose |
| --- | --- |
| {@link "@georeferencing/core" @georeferencing/core} (also `/core`) | Serializable documents, controller, transforms, projections, geometry and interchange |
| {@link "@georeferencing/core/engine" @georeferencing/core/engine} | Lazy processing workers, raster helpers and scheduler |
| {@link "@georeferencing/core/openlayers" @georeferencing/core/openlayers} | Host-map integration, reference providers and WFS discovery |
| {@link "@georeferencing/core/encoder-worker" @georeferencing/core/encoder-worker} | Protocol for custom raster codec workers |
| [`@georeferencing/core/worker`](./guides/workers-and-deployment.md#browser-assets) | Bundled processing-worker script |
| {@link "@georeferencing/plugins" @georeferencing/plugins} | All lazy format factories; prefer the per-format entries below |
| {@link "@georeferencing/plugins/geotiff" /geotiff}, {@link "@georeferencing/plugins/jpeg" /jpeg}, {@link "@georeferencing/plugins/pdf" /pdf}, {@link "@georeferencing/plugins/data" /data} | One export format family each |
| {@link "@georeferencing/plugins/tiff" @georeferencing/plugins/tiff} | Low-level TIFF encoding and validation |
| {@link "@georeferencing/plugins/report" @georeferencing/plugins/report} | Low-level PDF creation and optional map capture |
| {@link "@georeferencing/plugins/serializers" @georeferencing/plugins/serializers} | Pure QGIS points, world-file and accuracy-report serializers |
| [`@georeferencing/plugins/geotiff-worker`](./guides/workers-and-deployment.md#encoder-assets), [`/jpeg-worker`](./guides/workers-and-deployment.md#encoder-assets) | Bundled codec-worker scripts |
| {@link "@georeferencing/react" @georeferencing/react} | Ready-made editor, panels, types and subscription hook |
| [`@georeferencing/react/styles.css`](./guides/getting-started.md#attach-to-an-existing-map) | Optional scoped editor styles |

Worker script entries have no API of their own: load them as workers (the deployment
guide shows how), not as ordinary or SSR imports. API
signatures and guides keep source pixels, reference/working/map CRSs, raster output
and geographic features separate. The packages and this documentation are MIT
licensed; redistributing the library workers also requires their bundled notices.
