# Georeferencing

[![CI](https://github.com/tobilg/georeferencing/actions/workflows/ci.yml/badge.svg)](https://github.com/tobilg/georeferencing/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@georeferencing/core?label=%40georeferencing%2Fcore)](https://www.npmjs.com/package/@georeferencing/core)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Georeference images in the browser against an existing OpenLayers map. Users load
a local image, pair image points with map locations, fit one of seven QGIS-style
transformations, export a real GeoTIFF and optionally draw points, lines and
polygons that your application persists.

- **Local processing.** Decoding, fitting and warping run in browser workers. No
  backend, WASM runtime, CDN or telemetry is required.
- **Bring your own map.** The editor attaches to a host-owned OpenLayers map and
  never disposes host layers or views.
- **Host-owned persistence.** Saves hand your application immutable, revisioned
  GeoJSON snapshots with stable IDs and provenance.
- **Opt-in exports.** GeoTIFF, JPEG + world file, PDF report, session JSON, QGIS
  `.points`, accuracy reports and world files load only when used.
- **QGIS parity.** Transforms and resampling are tested against fixtures produced
  by QGIS 3.44 and GDAL.

📖 **[API documentation and guides](https://georeferencing-api-docs.gh.tobilg.com)** ·
🗺️ **[Live demo](https://georeferencing-demo.gh.tobilg.com)**

## Packages

| Package | Description |
| --- | --- |
| [`@georeferencing/core`](packages/core/README.md) [![npm](https://img.shields.io/npm/v/@georeferencing/core)](https://www.npmjs.com/package/@georeferencing/core) | Headless sessions, transforms, worker processing and OpenLayers adapters. No React or PDF dependency. |
| [`@georeferencing/plugins`](packages/plugins/README.md) [![npm](https://img.shields.io/npm/v/@georeferencing/plugins)](https://www.npmjs.com/package/@georeferencing/plugins) | Optional GeoTIFF, JPEG, PDF and data exports with per-format entry points. |
| [`@georeferencing/react`](packages/react/README.md) [![npm](https://img.shields.io/npm/v/@georeferencing/react)](https://www.npmjs.com/package/@georeferencing/react) | Ready-made editor, composable panels, a subscription hook and scoped CSS. |

All three packages are released together with the same version number. **Always
install the same version of every `@georeferencing/*` package.** Plugins and
React depend on core; mismatched versions can install a second copy of core with a
separate proj4 projection registry. See
[keep package versions aligned](https://georeferencing-api-docs.gh.tobilg.com/Getting_started/#keep-package-versions-aligned).

## Install

```sh
npm install @georeferencing/core @georeferencing/react @georeferencing/plugins react react-dom ol
# or
pnpm add @georeferencing/core @georeferencing/react @georeferencing/plugins react react-dom ol
```

Peers: React/React DOM `>=19.3.0 <20` and OpenLayers `>=10.10.0 <11`. React and
OpenLayers stay owned by your application. Headless integrations need only
`@georeferencing/core` (plus `ol` for the map adapters).

The packages are ESM-only and ship TypeScript declarations. Browser processing
requires module workers, File/Blob, OffscreenCanvas and Web Crypto in a secure
context. Importing the packages is SSR-safe; no map or worker is created at import.

## Quick start

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
        onSave: persist,
      }),
  );
  return <Georeferencer controller={controller} referenceMap={map} />;
}
```

With Vite, emit module workers:

```ts
// vite.config.ts
export default { worker: { format: "es" } };
```

The controller is the single authority over the session: don't mutate its
document behind its back. Keep it across remounts, and call
`controller.dispose()` (and `engine.dispose()` for an engine you own) when the
session is permanently closed. `onSave` must resolve only after durable storage
and reject on failure; retries reuse the same request ID.

For first-time users, pass your map's rendered target as `referenceView` to get
the guided four-step layout (load, match, check, export/draw) with minimal
controls, and enable expert controls one by one with the `controls` prop. The
[live demo](https://georeferencing-demo.gh.tobilg.com) uses this layout; see the
[React README](packages/react/README.md#guided-four-step-layout).

## Documentation

| Guide | Covers |
| --- | --- |
| [Getting started](https://georeferencing-api-docs.gh.tobilg.com/Getting_started/) | Installation, version alignment, host-map integration and composable UI |
| [Capabilities and limits](https://georeferencing-api-docs.gh.tobilg.com/Capabilities_and_limits/) | Supported models, input formats, resource budgets and integration boundaries |
| [Optional export plugins](https://georeferencing-api-docs.gh.tobilg.com/Optional_export_plugins/) | Registering formats, export results and custom exporters |
| [Coordinates and raster output](https://georeferencing-api-docs.gh.tobilg.com/Coordinates_and_raster_output/) | Pixel conventions, CRS spaces, residuals, resampling and output settings |
| [Reference data](https://georeferencing-api-docs.gh.tobilg.com/Reference_data/) | WFS, borrowed layers, GeoJSON, custom loaders and snapping |
| [Image lifecycle and saving](https://georeferencing-api-docs.gh.tobilg.com/Image_lifecycle_and_saving/) | Image replacement, guards, confirmation, review and save semantics |
| [Workers, packaging and deployment](https://georeferencing-api-docs.gh.tobilg.com/Workers,_packaging_and_deployment/) | Worker assets, CSP, projections, datum grids and budgets |

The guides' sources live in [`packages/documentation/guides`](packages/documentation/guides).
Each package README also covers its own API in depth.

## At a glance

- **Inputs:** 8-bit PNG, JPEG (grayscale/RGB), static WebP and single-page 8-bit
  TIFF (uncompressed, LZW, Deflate or PackBits). All eight EXIF orientations are
  normalized. Default limits are 25 MiB compressed and 24 megapixels.
- **Models:** linear, Helmert, polynomial 1–3, projective and thin plate spline.
- **Resamplers:** nearest, bilinear, cubic, cubic spline and Lanczos, shared by
  preview and export.
- **Output:** uint8 RGBA GeoTIFF (none/Deflate/PackBits, optional numeric no-data)
  with an EPSG code below 32767; JPEG with `.jgw` and `.crs.json` sidecars.
- **References:** WFS 1.1/2.0 (GeoJSON or GML), existing vector layers, GeoJSON
  and custom loaders, with vertex/edge snapping. Requests go through an
  injectable `request` function, so authentication stays in your application.
- **Projections:** EPSG:3857 and EPSG:4326 are built in. Register other CRSs
  through proj4 definitions, plus NTv2 datum grids where needed.

Out of scope: COG output, multi-page or scientific sample types, arbitrary-WKT
TIFF output and automatic antimeridian splitting. Unsupported requests fail with
explicit errors. See [capabilities and limits](packages/documentation/guides/capabilities.md).

## Development

The repository is a pnpm workspace. Use Node.js 22.12+ and pnpm 12.x.

```sh
pnpm install --frozen-lockfile
pnpm dev          # build and watch the packages and start the demo
```

Open the printed URL and choose **Try the Hamburg example**: select a point in the
image, then its matching map location; repeat and choose **Run alignment**. The
demo map uses OpenStreetMap tiles and needs an internet connection.

| Command | Purpose |
| --- | --- |
| `pnpm build` | Build all packages in dependency order |
| `pnpm lint` / `pnpm lint:fix` | Biome formatting, lint and import checks |
| `pnpm typecheck` | TypeScript checks for packages, demo, docs examples and tests |
| `pnpm test` | Unit and QGIS/GDAL fixture regression tests (Vitest) |
| `pnpm test:browser` | Playwright tests in Chromium, Firefox and WebKit |
| `pnpm test:consumer` | Pack, install and test clean consumer apps (needs Playwright Chromium and `pdfinfo`) |
| `pnpm docs:dev` | Build, watch and serve the documentation at http://127.0.0.1:4174 |
| `pnpm test:docs` | Strict TypeDoc build plus link and search checks |
| `pnpm release:check` | Pack all packages and verify the tarball contents |

Repository layout:

- [`packages/core`](packages/core), [`packages/plugins`](packages/plugins),
  [`packages/react`](packages/react): the published packages.
- [`packages/demo`](packages/demo/README.md): the Hamburg demo app, deployed to
  [georeferencing-demo.gh.tobilg.com](https://georeferencing-demo.gh.tobilg.com)
  (not published to npm).
- [`packages/documentation`](packages/documentation/README.md): the TypeDoc site
  deployed to [georeferencing-api-docs.gh.tobilg.com](https://georeferencing-api-docs.gh.tobilg.com).
- [`tests`](tests): unit tests, [browser tests and harnesses](tests/browser/harness/README.md),
  [clean consumer apps](tests/consumers/README.md),
  [committed reference fixtures](tests/fixtures/README.md) and the
  [QGIS/GDAL scripts that regenerate them](tests/reference/README.md).
- [`benchmarks`](benchmarks/README.md): browser processing and memory measurements.
- [`scripts`](scripts): package builds, packing and verification runners.

The regression tests use the committed fixtures and need no GIS installation.
Docker (pinned QGIS image) and native GDAL are needed only to regenerate the
fixtures; see [tests/reference](tests/reference/README.md).

Releases are published from GitHub Actions; see [RELEASING.md](RELEASING.md).

## License

[MIT](LICENSE). Bundled third-party notices ship in each package's
`dist/licenses`. The demo's example aerial image is © Freie und Hansestadt
Hamburg, Landesbetrieb Geoinformation und Vermessung (LGV), dl-de/by-2-0; see
[imagery credits](packages/demo/public/IMAGERY.md).
