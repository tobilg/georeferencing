# @georeferencing/demo

Private React 19/Vite application demonstrating the public APIs of
`@georeferencing/core`, `@georeferencing/plugins` and `@georeferencing/react`.
It is a runnable host integration and is not published to npm. Try it at
**https://georeferencing-demo.gh.tobilg.com**.

The main app is a guided Hamburg harbour example: choose an image, select matching
image/map locations, explicitly run alignment, review, then export or draw. It
owns an OpenLayers map and enables export plugins and a labeled browser-local save
adapter. Image processing runs locally in workers. Automated test harnesses live
separately under [`tests/browser/harness`](../../tests/browser/harness/README.md).

## Requirements and quick start

Use Node.js **22.12+** and **pnpm 12.x**. No minor/patch pnpm version is pinned.
Run commands from the repository root, not this package directory:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` builds core, plugins and React, watches their source/styles and starts
Vite for the demo. Open the URL Vite prints, normally `http://127.0.0.1:5173`.
The reference map opens on Hamburg harbour with OpenStreetMap street-map tiles.
An internet connection is required for the map; no API key is needed. The supplied
Hamburg aerial photo loads separately as the source image to align.

To serve only the app after building its library dependencies:

```sh
pnpm build:packages
pnpm --filter @georeferencing/demo run dev --port 5198 --strictPort
```

Use the root `pnpm dev` command while editing library source. App-only Vite serves
compiled package exports; it does not compile changes in sibling source packages.
The `workspace:*` dependencies and Vite dependency exclusions exercise the same
public entry points used by npm consumers, rather than private source aliases.

## Try the complete workflow

1. Click **Try the Hamburg example**, or choose/drop a local image. The bundled
   1240×697 WebP is an aerial image from Hamburg LGV (see
   [imagery credits](public/IMAGERY.md)); no pairs are prefilled.
2. Click a recognizable ground-level corner in the source, then the same location
   on the map. The instruction and active view advance automatically. Repeat for
   at least three well-distributed, noncollinear pairs for the default affine model.
   Quay corners and bridge ends work better than boats, shadows or elevated roofs.
3. Choose **Run alignment**. The demo defaults to **Manual** preview, so collecting
   pairs does not start fitting. **Automatic** updates previews after eligible
   committed edits; choose **Review alignment** when ready to review.
4. Inspect overlay opacity and residuals. **Edit points** permits corrections;
   edits clear stale results and manual mode requires another run. Rank/domain
   errors remain actionable; minimum point count alone is not proof of validity.
5. Expand **Raster output & session files** to configure/export GeoTIFF, JPEG,
   PDF or supplementary artifacts. Export does not require digitizing.
6. Choose **Confirm alignment and draw** for optional points, lines and polygons.
   Edit/delete them and save through the demo adapter. Returning to alignment keeps
   drawings geographically anchored and requires renewed review before saving.
7. Replace/remove the image to exercise Save/Discard/Cancel while preserving the
   map view. Session files and draft saving remain available before alignment.

Both viewers remain side by side on desktop, including 1024 px-wide screens.
Below 720 px, explicit Image/Map buttons follow the pending pair; the map and
image state stay mounted. Shift-drag pans while matching, Escape cancels a pending
pair, and the **Pan image**/**Match points** tools make the active interaction explicit.
Developer diagnostics and save-failure injection are
under **Developer tools & demo persistence**.

The image picker/drop zone accepts up to 25 MiB, subject to the core decoded-pixel
and memory budgets. Unsupported inputs or degenerate fits are reported explicitly.
No image is uploaded by the demo's processing path.

## Pages and source layout

| Path / file | Purpose |
| --- | --- |
| `/`, `index.html`, `main.tsx` | Guided Hamburg matching, manual preview, OpenStreetMap reference and local host saving |
| `exports.ts` | Explicit format selection and lazy plugin configuration, including a current-map accessor for PDF |
| `style.css` | Demo layout, separate from the React package's scoped editor CSS |
| `public/elbphilharmonie.webp` | Original Hamburg source image, loaded without alignment |
| `vite.config.ts` | ES module workers, relative production base and workspace filesystem access |

The production build emits only `index.html`. The demo exposes `window.demo`
for automated inspection; this is a test handle, not a supported library export.
The separate integration and engine harnesses are served by `pnpm dev:harness`,
not by the demo server or its production build.

## Reference data and saving

The main map uses EPSG:3857 and OpenLayers' `OSM` source with standard
`https://tile.openstreetmap.org/{z}/{x}/{y}.png` tiles. Roads, building outlines,
shorelines and labels provide visual reference for image/map matching. The map
loads tiles as you pan and zoom, with visible © OpenStreetMap contributors attribution.
The initial Hamburg extent and **Show Hamburg area** change only the map view;
they do **not** locate the unreferenced source image or constrain navigation.

Tile failures show a **Retry map tiles** button. Manual coordinate entry remains
available, and retrying preserves collected pairs and the current map view.
There is no bundled basemap or offline tile download. Use a suitable tile provider
for your application's usage; follow the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

Match stable ground-level quay corners or bridge ends visible in both the aerial
photo and the map. This is a matching exercise, not a surveyed accuracy fixture.
See [image and map provenance](public/IMAGERY.md) for the source photo and map credits.

The separate [validation harness](../../tests/browser/harness/README.md) has host-owned vector layers. Browser test
helpers provide known affine GCPs and deterministic bounded/paged WFS responses.
Reference refresh never moves previously selected GCP snapshots. These setups are
test data and are not part of the public demo workflow.

The save callbacks persist JSON only in this browser origin's `localStorage`:

| Key | Contents |
| --- | --- |
| `georeferencer-demo:<documentId>` | Accepted-feature save envelope and provenance |
| `georeferencer-demo-draft:<documentId>` | Draft document, including unfinished alignment |

This is demonstration persistence, not a database or production storage service.
Original image bytes are not stored. Reloading does not automatically reopen the
previous editor/file. Downloaded sessions require the matching original image to
restore; exports do not acknowledge persistence. Browser storage restrictions or
quota errors can make demo saves fail while leaving the draft available.

To remove demo records, use the browser's storage inspector and delete only the
keys with the two prefixes above. Changing host or port creates a different origin
with separate local storage.

## Adapt this integration for your application

Use the package READMEs as the supported integration contract:

- [Core](https://github.com/tobilg/georeferencing/blob/main/packages/core/README.md): controllers, coordinates, lifecycle, reference providers and saving.
- [Plugins](https://github.com/tobilg/georeferencing/blob/main/packages/plugins/README.md): format selection, results, codec assets and limits.
- [React](https://github.com/tobilg/georeferencing/blob/main/packages/react/README.md): ready-made UI, composable panels, Strict Mode and host extensions.

Replace the Hamburg reference/working CRS and localStorage callbacks with actual host
configuration. Retain a stable map, controller and binding configuration. Keep
projection definitions/grids consistent between engine and map adapters. Choose
only required export factories in `exports.ts`; removing them must not disable
feature persistence. Preserve immutable save revisions, idempotency keys and
document-scoped deletion semantics in the real storage adapter.

The demo's worker imports use Vite's `?worker` handling for the core engine; optional
codec factories can use their default relative URLs. A different bundler or CSP
may require explicit worker factories/URLs. Copying only this app's JSX without
its styles, dependencies and worker configuration is insufficient.

## Build and preview

```sh
pnpm build:demo
pnpm --filter @georeferencing/demo run preview --port 4173 --strictPort
```

`build:demo` builds public package dependencies first, then emits
`packages/demo/dist`. Vite's relative base permits static hosting below a path.
The preview server serves that existing build; it does not watch source or publish
a site. CI builds the demo on every change; the
[release workflow](../../RELEASING.md) deploys it to Cloudflare Pages
(https://georeferencing-demo.gh.tobilg.com) for each pushed `v*` tag. The package is
never published to npm.

## Validation

Repository checks are shared at the workspace root:

```sh
pnpm typecheck
pnpm lint
pnpm test
PLAYWRIGHT_PORT=5198 pnpm test:browser
pnpm test:consumer
```

Browser tests require installed Playwright Chromium, Firefox and WebKit binaries.
If they are missing, install them with `pnpm exec playwright install` on a machine
that permits the browser downloads. Playwright builds the public packages and
starts the local demo and a separate harness server. `PLAYWRIGHT_PORT` selects
the demo port; the harness defaults to the next port (override with `HARNESS_PORT`).
Use two free ports to avoid reusing unrelated servers.

`tests/browser` covers image/GCP workflows, orientation, nonlinear landmarks,
reference loading, multiple editors, plugin selection, JPEG sidecars, saving,
replacement and cleanup. Guided tests intercept OSM requests with deterministic
fixture pixels, including failure/retry cases; they do not download public tiles
or verify OSM cartography. `test:consumer` additionally packs the public packages,
installs fresh consumers and checks SSR/types, production assets, CSP and exports.
Reference scripts under `scripts/` have separate native GDAL/QGIS requirements;
see the [release guide](https://github.com/tobilg/georeferencing/blob/main/RELEASING.md)
for regeneration prerequisites; normal regression tests use committed reference fixtures.

## Troubleshooting and license

| Symptom | Action |
| --- | --- |
| Package export/module not found | Run `pnpm install --frozen-lockfile` and `pnpm build:packages` from the root |
| Sibling code edits are not reflected | Use root `pnpm dev`, or rebuild the affected package |
| Port already in use | Select a free port with `--port … --strictPort` |
| No overlay while collecting pairs | In Manual mode, complete enough pairs and choose Run alignment |
| Map tiles fail to load | Check the network and choose Retry map tiles; manual coordinate entry remains available |
| Image appears misplaced | Check ground-level correspondences and spatial distribution, then rerun; map bounds never georeference the source |
| Save fails | Check the intentional failure toggle, browser storage permissions/quota and visible errors |
| Export controls absent or a worker fails | Check `exports.ts`, package builds, emitted asset URLs and CSP |

The application source follows the repository's MIT license. Example imagery retains
its original rights and attribution; see [image provenance](public/IMAGERY.md). Public package worker assets
carry their own bundled third-party notices; retain those for redistribution.
