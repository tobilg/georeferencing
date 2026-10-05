---
group: Guides
title: Using core without React
---

# Using core without React

`@georeferencing/core` contains the whole editor except its user interface. You can
build your own UI on it with plain DOM code, another framework or a server-rendered
page that adds client scripts. This guide shows how the pieces fit together and walks
through a complete session. For the ready-made React editor, see
[React and map libraries](./react-integration.md).

## The building blocks

| Piece | Created by | Responsibility |
| --- | --- | --- |
| Engine | `createWorkerEngine()` from `@georeferencing/core/engine` | Decodes images, fits transformations and renders previews and exports in browser workers |
| Controller | `new GeoreferencerController(options)` | Holds the session state, validates every edit, runs operations on the engine and calls your persistence callbacks |
| Map adapter | `openLayers(map)`, `maplibre(map)` or `leaflet(map, { lib: L })` | Shows control points, the aligned preview and drawings on your map, and turns map clicks into control points |
| Your UI | You | Shows the image, lets users click on it and offers buttons for running, confirming, saving and exporting |

The controller is the single source of truth. The adapter and your UI read its
snapshot and call its methods. They never change the state directly.

```sh
pnpm add @georeferencing/core
# one map adapter with its map library, for example:
pnpm add @georeferencing/maplibre maplibre-gl
# optional output formats:
pnpm add @georeferencing/plugins
```

## Create a session

Create one engine and one controller per editing session:

```ts
import { GeoreferencerController } from "@georeferencing/core";
import { createWorkerEngine } from "@georeferencing/core/engine";
import { geoTiff } from "@georeferencing/plugins/geotiff";

const engine = createWorkerEngine();
const controller = new GeoreferencerController({
  workingCrs: "EPSG:3857",
  engine,
  previewMode: "manual",
  exports: [geoTiff()],
});
```

| Option | Purpose |
| --- | --- |
| `workingCrs` | Required. CRS used for fitting, residuals and the aligned preview, for example `"EPSG:25832"` for UTM data. Register custom definitions with the engine and the adapter |
| `engine` | Required. The engine runs all image work; one engine can serve several controllers |
| `previewMode` | `"automatic"` (default) fits after every eligible edit; `"manual"` waits for `refit()` |
| `exports` | Output formats from `@georeferencing/plugins`; none are enabled by default |
| `digitizing` | Allow drawing points, lines and polygons after the alignment is confirmed |
| `onSave`, `onSaveDraft` | Persist accepted features or unfinished work; see [lifecycle and saving](./lifecycle-and-saving.md) |
| `onChange` | Mirror every committed document, for example for autosave indicators; not a save receipt |
| `guard` | Decide `"save"`, `"discard"` or `"cancel"` before unsaved work is replaced; without it, such replacements are cancelled |
| `onError` | Structured errors with a `code`, for logging or localized messages |
| `onActiveToolChange` | Coordinate your own map interactions with the editor's active tool |
| `initialDocument`, `drawingBounds` | Start from a stored document; restrict where accepted drawings may lie |

## Read the state

`controller.subscribe(listener)` calls the listener after every change and returns an
unsubscribe function. Read the current state with `controller.getSnapshot()`. The
snapshot is frozen: render from it, never modify it.

| Snapshot field | Meaning |
| --- | --- |
| `document` | The serializable session: `sourceImage`, `gcps`, `model`, `workingCrs`, `features`, `output` and revision counters |
| `imageUrl`, `detailImageUrl` | Object URLs of the reduced preview image and, once requested, the full-resolution image |
| `tool`, `mode` | Active tool (`"navigate"`, `"gcp"`, `"Point"`, `"LineString"`, `"Polygon"`, `"modify"`) and stage (`"align"` or `"draw"`) |
| `pendingImagePoint` | Image point waiting for its map location, or `null` |
| `fit`, `fitRevision` | Current transformation with per-point `residuals` and `rmse`; valid only while `fitRevision` equals `document.alignmentRevision` |
| `preview` | The rendered overlay shown by the map adapter |
| `loading`, `fitting`, `exporting`, `saving` | Operation states: `"idle"`, `"running"`, `"succeeded"`, `"failed"` or `"cancelled"` |
| `error`, `errorDetail` | Last error message, and its code and recoverability |
| `dirty`, `canUndo`, `canRedo` | Unsaved changes and undo/redo availability |

## Walk through a session

1. **Load an image.** `await controller.loadImage(file)` reads the file in a worker,
   creates a reduced preview (`snapshot.imageUrl`) and returns `false` if the guard
   cancelled the replacement or the image is not supported.
2. **Pair image and map points.** Activate the tool with `controller.setTool("gcp")`.
   When the user clicks the image, call `controller.setPendingPoint([x, y])` with
   original-resolution pixel coordinates. The next click on the map completes the pair:
   the adapter projects it to the working CRS and calls `addGcp`, snapping to reference
   data where configured. For typed coordinates, call
   `controller.addGcp(imagePoint, target, crs)` yourself. `updateGcp`, `removeGcp`,
   `undo` and `redo` edit existing pairs.
3. **Fit.** Choose a model with `controller.setModel("polynomial1")` (see the
   [model table](./capabilities.md#transformations-and-coordinates)), then
   `await controller.refit()` in manual mode. On success `snapshot.fit` holds the
   transformation and residuals and the adapter shows the aligned preview;
   `binding.fitOverlay()` zooms the map to it. On failure `snapshot.error` explains why,
   for example too few points or a degenerate arrangement.
4. **Confirm.** `controller.confirm()` accepts the current alignment. With
   `digitizing: true` the controller enters the drawing stage, where
   `setTool("Polygon")` and the other drawing tools draw on the map through the adapter.
   `returnToAlignment()` goes back; drawings stay where they are.
5. **Save and export.** `await controller.save()` sends the accepted features to
   `onSave`. `await controller.export("geotiff")` returns the produced files as
   `{ name, blob }` entries; `getExportUnavailable(id)` explains why an export cannot run
   yet.

The image shown in your UI is the reduced preview, not the original. Convert a click
from display pixels to original pixels with `document.sourceImage.width` and `.height`.
Image coordinates start at the top-left corner of the image, with y pointing down.

## Attach a map

An adapter is a function that attaches the controller to one map. Calling it returns a
`MapBinding`; `detach()` removes everything it added and leaves your map as it was.

```ts
import { maplibre } from "@georeferencing/maplibre";

const binding = maplibre(map, { references })(controller);
// later
binding.detach();
```

Every adapter package also exports an attach function that does the same:
`attachReferenceMap(map, controller, options)` for OpenLayers,
`attachMapLibre(map, controller, options)` and
`attachLeaflet(map, controller, { lib: L, ...options })`. Attach a controller to only
one map at a time. Besides `detach`, a binding offers `fitOverlay()` and
`cancelDrawing()`, and depending on the adapter `resize()`, `finishDrawing()`,
`navigateHistory(direction)` and `capture()`; see the
[map adapters guide](./map-adapters.md) for what each adapter supports.

## A complete page

This example wires the controller to plain DOM elements and any map adapter: choosing
a file loads it, clicking the image starts a point pair, clicking the map completes it,
and two buttons run the alignment and download a GeoTIFF.

{@includeCode ../examples/headless.ts}

## Store and resume sessions

`snapshot.document` is plain JSON: store `JSON.stringify(controller.getSnapshot().document)`,
or register the `session()` export from `@georeferencing/plugins/data` to download it.
A session never contains image bytes. To resume, keep the original file and call
`await controller.restoreSession(json, file)`; the controller checks that the file
matches the stored fingerprint. `onSaveDraft` and the guard integrate the same
document with your own storage; see [lifecycle and saving](./lifecycle-and-saving.md).

## Clean up

When a view is hidden only temporarily, `controller.suspend()` cancels running work
and releases image URLs, and `controller.start()` resumes. When the session is over:

1. unsubscribe your listeners and call `binding.detach()`,
2. call `controller.dispose()`,
3. call `engine.dispose()` unless other controllers share the engine.

The controller never disposes your map or the engine.

## Numerical API

The transformation functions work without a controller, an image or workers, for
example to transform coordinates on a server:

```ts
import { fitTransform, forward, type Gcp } from "@georeferencing/core";

const gcps: Gcp[] = [
  { id: "a", label: 1, enabled: true, image: [0, 0], target: [1000, 2000], crs: "EPSG:3857" },
  { id: "b", label: 2, enabled: true, image: [100, 0], target: [1200, 2000], crs: "EPSG:3857" },
  { id: "c", label: 3, enabled: true, image: [0, 100], target: [1000, 1700], crs: "EPSG:3857" },
];
const fit = fitTransform(gcps, "polynomial1");
forward(fit, [50, 50]); // approximately [1100, 1850]
```

`backward(fit, target)` maps the other way, `validateDomain(fit, width, height)` checks
that a fit can be rendered over an image, and `project`/`createConverter` convert
coordinates between CRSs. All targets passed to `fitTransform` must already be in one
CRS.
