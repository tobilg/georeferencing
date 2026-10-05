# @georeferencing/openlayers

[![npm](https://img.shields.io/npm/v/@georeferencing/openlayers)](https://www.npmjs.com/package/@georeferencing/openlayers)

OpenLayers map adapter for [georeferencing](https://github.com/tobilg/georeferencing).
It connects a `GeoreferencerController` from `@georeferencing/core` to an existing,
host-owned OpenLayers map:

- the warped image preview as a reprojectable image layer, with opacity and visibility
- control-point markers with labels, draggable while matching, and residual vectors
- picking map coordinates for control points, with optional reference snapping
- drawing and modifying points, lines and polygons (native OpenLayers interactions)
- reference layers: WFS (GeoJSON **and GML**), static GeoJSON, custom loaders, and
  vector layers the host already owns
- linked image/map navigation, map view history and capture for PDF reports

It is the most complete adapter: OpenLayers can display any projection, so previews are
shown in the working CRS and the map itself may use a custom CRS.

📖 [API documentation](https://georeferencing-api-docs.gh.tobilg.com) ·
🗺️ [Live demo](https://georeferencing-demo.gh.tobilg.com)

## Installation

```sh
npm install @georeferencing/core @georeferencing/openlayers ol
# with the React editor and export plugins:
npm install @georeferencing/react @georeferencing/plugins react react-dom
```

Peers: `@georeferencing/core` (same version as this package) and OpenLayers
`>=10.10.0 <11`. Install the same version of every `@georeferencing/*` package. No
drawing library is needed: drawing uses OpenLayers' own interactions.

Import `ol/ol.css` for the map controls. If the map target is focusable (it has a
`tabindex`, for keyboard navigation), OpenLayers ignores mouse panning and wheel zoom
until the map has focus. Create the map with
`interactions: defaults({ onFocusOnly: false })` from `ol/interaction/defaults.js` so
both work immediately.

## Use with the React editor

Create the adapter once per map, for example with `useMemo`, and pass it as `map`:

```tsx
import { useMemo } from "react";
import type OLMap from "ol/Map.js";
import { openLayers } from "@georeferencing/openlayers";
import { Georeferencer, type GeoreferencerController } from "@georeferencing/react";
import "@georeferencing/react/styles.css";

export function Editor({ map, controller }: { map: OLMap; controller: GeoreferencerController }) {
  const adapter = useMemo(() => openLayers(map, { /* options */ }), [map]);
  return <Georeferencer controller={controller} map={adapter} />;
}
```

The editor attaches the adapter on mount and detaches it on unmount; the map, its
layers and its view stay untouched. A new adapter object re-attaches the map, so keep
both the adapter and its options stable. To create the map inside the editor's guided
layout (its `referenceView`), use the `useHostMap` pattern from the
[React and map libraries guide](https://georeferencing-api-docs.gh.tobilg.com/React_and_map_libraries/),
which has a complete OpenLayers example.

## Use without React

`attachReferenceMap(map, controller, options)` attaches directly and returns the
binding (`openLayers(map, options)(controller)` does the same). Call `detach()` when
done.

```ts
import type { Extent, GeoreferencerController } from "@georeferencing/core";
import type { WfsReference } from "@georeferencing/core/map";
import { attachReferenceMap } from "@georeferencing/openlayers";
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
    snapping: { vertices: true, tolerancePx: 10 },
    request: (url, init) => fetch(url, { ...init, credentials: "include" }),
  };
  const binding = attachReferenceMap(map, controller, { references: [reference] });
  return () => binding.detach();
}
```

Your UI drives the controller: load an image, activate the control-point tool, set the
image point of a pair, run the fit, confirm. The adapter completes pairs from map
clicks and shows the result. The
[core usage guide](https://georeferencing-api-docs.gh.tobilg.com/Using_core_without_React/)
walks through a complete page.

The binding implements every member of `MapBinding` from `@georeferencing/core/map`:

| Member | Purpose |
| --- | --- |
| `detach()` | Remove every layer, interaction and listener the adapter added; idempotent |
| `fitOverlay()` | Zoom the map to the aligned preview |
| `cancelDrawing()`, `finishDrawing()` | Abort a pending pair or sketch; complete a line or polygon |
| `navigateHistory(-1 \| 1)` | Step back and forward through recorded map views |
| `resize()` | Call `map.updateSize()` after the container changed size |
| `capture()` | Capture the map for PDF reports (`captureOpenLayersMap`) |
| `layers` | The owned `gcps`, `drafts` and `preview` layers, for display integration; do not dispose them |

## Options

| Option | Purpose |
| --- | --- |
| `references` | Reference providers: `wfs`, `geojson`, `custom` (from `@georeferencing/core/map`) and `existing-vector` (a host-owned layer, read without taking ownership). Add `snapping` to a provider to snap control points to it |
| `definitions`, `datumGrids` | Projection definitions and NTv2 grids, registered with proj4 and OpenLayers |
| `initialView` | `{ extent, crs }` to frame the map when attaching; it never georeferences the image |
| `digitizingSnapping` | Snap drawings to references (`references: true`) and/or other drafts (`drafts: true`) |
| `debounceMs` | Delay before refreshing viewport references after navigation (150 ms) |
| `geometryTolerancePx` | Densification tolerance when converting drawings to longitude/latitude (0.25 px) |
| `onReferenceStatus` | Observe loading, error and completeness feedback per provider |

Use the same `definitions` and `datumGrids` for the worker engine. Invalid definitions
or grids throw before anything is attached; later failures, such as an unknown map
projection or a control point that cannot be projected, appear in the controller's
error state.

To snap to vector data your application already shows, pass its layer as an
`existing-vector` reference. The adapter reads its source but never adds, clears or
disposes the layer:

```ts
const adapter = openLayers(map, {
  references: [
    { kind: "existing-vector", id: "parcels", label: "Parcels", layer: parcelLayer, snapping: { vertices: true } },
  ],
});
```

## Projections

The map may use any projection that proj4 can define, for example a national grid.
Pass its definition in `definitions`: the adapter registers it with core's proj4
instance and with OpenLayers. To register definitions before creating the map (for a
`View` in that projection), call `registerProjections(definitions, datumGrids)` first.
The preview is rendered in the working CRS, and OpenLayers reprojects it to the map
projection.

## What it adds to your map

| Element | Details |
| --- | --- |
| Layers | Reference layers (z-index 998), the preview image layer (999), residuals (1001), drafts (1002) and control points (1003) |
| Interactions | `Modify` for dragging control points while matching; `Draw`, `Select`, `Modify` and `Snap` while drawing |
| Events | Map `moveend` and view changes; `keydown` on the map target: Escape cancels a pending pair or sketch, Enter finishes a sketch |
| Cursor | Crosshair on the viewport while a map click places a control point or draws |

`detach()` removes everything listed here and restores the cursor. Layers passed as
`existing-vector` stay untouched.

## References

Viewport queries follow navigation and intersect optional provider bounds. WFS 1.1 and
2.0 are supported with GeoJSON or GML responses, explicit request/response axis order,
paging and byte budgets; truncation and service exceptions are reported, never hidden.
Manual coordinate entry keeps working when a reference fails. See the
[reference data guide](https://georeferencing-api-docs.gh.tobilg.com/Reference_data/).

## PDF reports

Pass a capture function to the PDF plugin to include the current map frame:

```ts
import { pdf } from "@georeferencing/plugins/pdf";
import { captureOpenLayersMap } from "@georeferencing/openlayers";

const formats = [pdf({ capture: () => captureOpenLayersMap(map) })];
```

Capture uses the currently loaded canvas layers; their sources must allow CORS export.
DOM overlays are not captured.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Dragging and the mouse wheel do nothing until the map is clicked | Create the map with `defaults({ onFocusOnly: false })` |
| "Unknown map projection" | The map projection's definition is in `definitions`, or registered with `registerProjections` before creating the map |
| References appear in the wrong place | Request/response CRS and `axisOrder`/`responseAxisOrder` of the WFS |
| The PDF report fails with a canvas error | Every tile source allows CORS (`crossOrigin: "anonymous"`) |
| The editor's layers appear below your layers | Your layers use a z-index above 998; lower it or adjust the owned `layers` |

## Migrating from `@georeferencing/core/openlayers`

Before 0.4.0 this adapter shipped inside core. Import it from
`@georeferencing/openlayers` instead; shared reference types and WFS discovery moved
to `@georeferencing/core/map`. The React editor now takes `map={openLayers(map, options)}`
instead of `referenceMap` and `bindingOptions`, and the PDF plugin takes
`capture` instead of `map`.

## License

[MIT](https://github.com/tobilg/georeferencing/blob/main/LICENSE)
