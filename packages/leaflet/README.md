# @georeferencing/leaflet

[![npm](https://img.shields.io/npm/v/@georeferencing/leaflet)](https://www.npmjs.com/package/@georeferencing/leaflet)

Leaflet map adapter for [georeferencing](https://github.com/tobilg/georeferencing). It
connects a `GeoreferencerController` from `@georeferencing/core` to an existing,
host-owned Leaflet map:

- the warped image preview as an image overlay, with opacity and visibility
- control-point markers with labels, draggable while matching, and residual vectors
- picking map coordinates for control points, with optional reference snapping
- drawing and editing points, lines and polygons with [Terra Draw](https://terradraw.io)
- reference layers: WFS (GeoJSON responses), static GeoJSON and custom loaders
- linked image/map navigation and map view history

📖 [API documentation](https://georeferencing-api-docs.gh.tobilg.com) ·
🗺️ [Live demo](https://georeferencing-demo.gh.tobilg.com/?map=leaflet)

## Installation

```sh
npm install @georeferencing/core @georeferencing/leaflet leaflet
# for drawing (digitizing: true):
npm install terra-draw terra-draw-leaflet-adapter
# with the React editor and export plugins:
npm install @georeferencing/react @georeferencing/plugins react react-dom
```

Peers: `@georeferencing/core` (same version as this package), Leaflet `^1.9.4`, and
optionally `terra-draw` `^1.36.0` with `terra-draw-leaflet-adapter` `^1.3.0`. Install
the same version of every `@georeferencing/*` package. Import
`leaflet/dist/leaflet.css` as for any Leaflet map. TypeScript projects also need
Leaflet's type declarations, which this package's types refer to:
`npm install -D @types/leaflet`.

## Use with the React editor

Pass the Leaflet module as `lib`. The adapter never imports Leaflet itself, because
Leaflet accesses `window` when it is imported: this package can be imported during
server-side rendering and works with a Leaflet loaded as a global.

```tsx
import { useMemo } from "react";
import L from "leaflet";
import { leaflet } from "@georeferencing/leaflet";
import { Georeferencer, type GeoreferencerController } from "@georeferencing/react";
import "@georeferencing/react/styles.css";

export function Editor({ map, controller }: { map: L.Map; controller: GeoreferencerController }) {
  // Create the adapter once per map: a new adapter re-attaches the editor.
  const adapter = useMemo(() => leaflet(map, { lib: L }), [map]);
  return <Georeferencer controller={controller} map={adapter} />;
}
```

The editor attaches the adapter when it mounts and detaches it when it unmounts; your
map, its layers and its view stay as they are. To create the map inside the editor's
guided layout (its `referenceView`), use the `useHostMap` pattern from the
[React and map libraries guide](https://georeferencing-api-docs.gh.tobilg.com/React_and_map_libraries/),
which has a complete Leaflet example.

## Use without React

`attachLeaflet(map, controller, options)` attaches directly and returns the binding
(`leaflet(map, options)(controller)` does the same):

```ts
import type { GeoreferencerController } from "@georeferencing/core";
import { attachLeaflet } from "@georeferencing/leaflet";
import L from "leaflet";

export function connect(map: L.Map, controller: GeoreferencerController) {
  const binding = attachLeaflet(map, controller, { lib: L });
  return {
    zoomToImage: () => binding.fitOverlay(),
    disconnect: () => binding.detach(),
  };
}
```

Your UI drives the controller: load an image, activate the control-point tool, set the
image point of a pair, run the fit, confirm. The adapter completes pairs from map
clicks and shows the result. The
[core usage guide](https://georeferencing-api-docs.gh.tobilg.com/Using_core_without_React/)
walks through a complete page.

The binding implements `MapBinding` from `@georeferencing/core/map`:

| Member | Purpose |
| --- | --- |
| `detach()` | Remove every layer, marker and listener the adapter added; idempotent |
| `fitOverlay()` | Zoom the map to the aligned preview |
| `cancelDrawing()`, `finishDrawing()` | Abort a pending pair or sketch; complete a line or polygon |
| `navigateHistory(-1 \| 1)` | Step back and forward through recorded map views |
| `resize()` | Call `map.invalidateSize()` after the container changed size |

There is no `capture()`; see [PDF reports](#pdf-reports).

## Options

```ts
const adapter = leaflet(map, {
  lib: L,
  references: [
    {
      kind: "geojson",
      id: "parcels",
      label: "Parcels",
      data: parcels,
      crs: "EPSG:4326",
      snapping: { vertices: true, edges: true },
    },
  ],
  digitizingSnapping: { references: true },
});
```

| Option | Purpose |
| --- | --- |
| `lib` | Required Leaflet module (`import L from "leaflet"`, or `window.L`) |
| `references` | Reference providers: `wfs` (GeoJSON responses), `geojson` and `custom`, from `@georeferencing/core/map`. Add `snapping` to a provider to snap control points to it |
| `definitions`, `datumGrids` | Projection definitions and NTv2 grids for references, targets, a custom map CRS and the working CRS; pass the same to the worker engine |
| `initialView` | `{ extent, crs }` to frame the map when attaching; it never georeferences the image |
| `digitizingSnapping` | Snap drawings to references (`references: true`) and/or other drafts (`drafts: true`) |
| `debounceMs` | Delay before refreshing viewport references after navigation (150 ms) |
| `onReferenceStatus` | Observe loading, error and completeness feedback per provider |

The adapter reads its options once when attaching. Keep the options object stable, or
create a new adapter when they change.

WFS GML responses and layers already owned by the host are supported by the OpenLayers
adapter only. Request GeoJSON output (`responseFormat: "geojson"`) from your WFS. See the
[reference data guide](https://georeferencing-api-docs.gh.tobilg.com/Reference_data/)
for axis order, paging, authentication and custom loaders.

## How it displays results

Leaflet places image overlays as rectangles in the map CRS. While attached, the adapter
calls `controller.setPreviewCrs()` with the map CRS (`map.options.crs.code`, Web
Mercator by default), so previews line up exactly. Maps with a custom Proj4Leaflet CRS
need its definition in `definitions`; `L.CRS.Simple` is not supported. Fitting,
residuals and raster exports keep using the document's working CRS.

## What it adds to your map

| Element | Details |
| --- | --- |
| Layers | A GeoJSON layer per reference provider, residual lines, a GeoJSON layer for drafts and an image overlay for the preview, kept below the other overlays |
| Markers | `L.marker`s with a `divIcon` of class `georef-gcp-marker` and the point label; draggable while matching points |
| Drawing | Terra Draw's layers, only while drawing tools are in use |
| Events | `click` and `moveend` on the map, `keydown` (Escape cancels a pending pair) on the container |
| Cursor | Crosshair on the map container while a map click places a control point |

`detach()` removes everything listed here, restores the cursor and resets the preview
CRS. Leaflet's shared default vector renderer belongs to the map and stays.

## Drawing

When the controller enables `digitizing`, the drawing tools use Terra Draw, loaded on
first use (its Leaflet adapter imports `leaflet` as a module). Finished sketches become
controller features with stable IDs in longitude/latitude; the modify tool loads the
current drafts into Terra Draw and commits each edit. Without the optional peers,
choosing a drawing tool reports an error and the rest of the editor keeps working.

## PDF reports

Leaflet renders tiles as DOM images rather than a canvas, so the binding has no
`capture()` and PDF reports omit the map page. All other report content is available:
configure `pdf()` without `capture`.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Attaching fails with "Cannot read properties of undefined" | `lib: L` is passed in the options |
| Tiles or markers are misplaced | `leaflet/dist/leaflet.css` is imported |
| The preview does not appear on a custom-CRS map | The Proj4Leaflet CRS's definition is in `definitions`; `L.CRS.Simple` is not supported |
| The map is cut off after a layout change | Call `map.invalidateSize()` (or the binding's `resize()`) |
| Reference data does not appear | The WFS returns GeoJSON; the provider's `onReferenceStatus` and the editor's reference panel show errors |
| Drawing tools report missing dependencies | `terra-draw` and `terra-draw-leaflet-adapter` are installed |

## License

[MIT](https://github.com/tobilg/georeferencing/blob/main/LICENSE)
