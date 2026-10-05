# @georeferencing/maplibre

[![npm](https://img.shields.io/npm/v/@georeferencing/maplibre)](https://www.npmjs.com/package/@georeferencing/maplibre)

MapLibre GL JS map adapter for [georeferencing](https://github.com/tobilg/georeferencing).
It connects a `GeoreferencerController` from `@georeferencing/core` to an existing,
host-owned MapLibre map:

- the warped image preview as an image source, with opacity and visibility
- control-point markers with labels, draggable while matching, and residual vectors
- picking map coordinates for control points, with optional reference snapping
- drawing and editing points, lines and polygons with [Terra Draw](https://terradraw.io)
- reference layers: WFS (GeoJSON responses), static GeoJSON and custom loaders
- linked image/map navigation, map view history and capture for PDF reports

📖 [API documentation](https://georeferencing-api-docs.gh.tobilg.com) ·
🗺️ [Live demo](https://georeferencing-demo.gh.tobilg.com/?map=maplibre)

## Installation

```sh
npm install @georeferencing/core @georeferencing/maplibre maplibre-gl
# for drawing (digitizing: true):
npm install terra-draw terra-draw-maplibre-gl-adapter
# with the React editor and export plugins:
npm install @georeferencing/react @georeferencing/plugins react react-dom
```

Peers: `@georeferencing/core` (same version as this package), MapLibre GL JS
`>=6.0.0 <7`, and optionally `terra-draw` `^1.36.0` with
`terra-draw-maplibre-gl-adapter` `^1.4.1`. Install the same version of every
`@georeferencing/*` package.

Two setup steps are required for every MapLibre map:

```ts
import { setWorkerUrl } from "maplibre-gl";
// MapLibre's stylesheet positions the control-point markers.
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre loads its web worker relative to its own module, and bundlers such as Vite
// do not emit that file on their own. Set the worker URL once, before creating maps:
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

setWorkerUrl(workerUrl);
```

The `?url` suffix is Vite syntax; TypeScript knows it through Vite's client types
(`"types": ["vite/client"]` in `tsconfig.json`, included in Vite's templates). Other
bundlers have their own way to emit an asset and return its URL.

## Use with the React editor

Wrap the map in an adapter and pass it as the editor's `map` prop. Create the adapter
once per map, for example with `useMemo`: a new adapter detaches and re-attaches the
editor.

```tsx
import { useMemo } from "react";
import type { Map } from "maplibre-gl";
import { maplibre } from "@georeferencing/maplibre";
import { Georeferencer, type GeoreferencerController } from "@georeferencing/react";
import "@georeferencing/react/styles.css";

export function Editor({ map, controller }: { map: Map; controller: GeoreferencerController }) {
  const adapter = useMemo(() => maplibre(map), [map]);
  return <Georeferencer controller={controller} map={adapter} />;
}
```

The editor attaches the adapter when it mounts and detaches it when it unmounts; your
map, its style and its view stay as they are. To create the map inside the editor's
guided layout (its `referenceView`), use the `useHostMap` pattern from the
[React and map libraries guide](https://georeferencing-api-docs.gh.tobilg.com/React_and_map_libraries/),
which has a complete MapLibre example.

## Use without React

`attachMapLibre(map, controller, options)` attaches directly and returns the binding
(`maplibre(map, options)(controller)` does the same):

```ts
import type { GeoreferencerController } from "@georeferencing/core";
import { attachMapLibre } from "@georeferencing/maplibre";
import type { Map } from "maplibre-gl";

export function connect(map: Map, controller: GeoreferencerController) {
  const binding = attachMapLibre(map, controller);
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
| `detach()` | Remove every source, layer, marker and listener the adapter added; idempotent |
| `fitOverlay()` | Zoom the map to the aligned preview |
| `cancelDrawing()`, `finishDrawing()` | Abort a pending pair or sketch; complete a line or polygon |
| `navigateHistory(-1 \| 1)` | Step back and forward through recorded map views |
| `resize()` | Call `map.resize()` after the container changed size |
| `capture()` | Capture the map for PDF reports (`captureMapLibreMap`) |

## Options

```ts
const adapter = maplibre(map, {
  references: [
    {
      kind: "wfs",
      id: "buildings",
      label: "Buildings",
      url: "https://example.com/wfs",
      version: "2.0.0",
      typeNames: ["buildings"],
      requestCrs: "EPSG:3857",
      axisOrder: "xy",
      responseFormat: "geojson",
      loading: "viewport",
      snapping: { vertices: true, tolerancePx: 10 },
    },
  ],
  digitizingSnapping: { references: true, drafts: true },
  beforeId: "labels",
});
```

| Option | Purpose |
| --- | --- |
| `references` | Reference providers: `wfs` (GeoJSON responses), `geojson` and `custom`, from `@georeferencing/core/map`. Add `snapping` to a provider to snap control points to it |
| `definitions`, `datumGrids` | Projection definitions and NTv2 grids for references, targets and the working CRS; pass the same to the worker engine |
| `initialView` | `{ extent, crs }` to frame the map when attaching; it never georeferences the image |
| `digitizingSnapping` | Snap drawings to references (`references: true`) and/or other drafts (`drafts: true`) |
| `debounceMs` | Delay before refreshing viewport references after navigation (150 ms) |
| `beforeId` | Insert the adapter's layers below this style layer, for example below labels |
| `onReferenceStatus` | Observe loading, error and completeness feedback per provider |

The adapter reads its options once when attaching. Keep the options object stable, or
create a new adapter when they change.

WFS GML responses and layers already owned by the host are supported by the OpenLayers
adapter only. Request GeoJSON output (`responseFormat: "geojson"`) from your WFS. See the
[reference data guide](https://georeferencing-api-docs.gh.tobilg.com/Reference_data/)
for axis order, paging, authentication and custom loaders.

## How it displays results

MapLibre shows raster overlays in Web Mercator only. While attached, the adapter calls
`controller.setPreviewCrs("EPSG:3857")`, so previews are rendered in Web Mercator and
their corners are exact. Fitting, residuals and raster exports keep using the
document's working CRS, which can be any CRS with a projection definition.

## What it adds to your map

| Element | Details |
| --- | --- |
| Sources and layers | IDs start with `georef-`: reference fill, line and circle layers per provider, the preview raster, residual lines and draft fill, line and circle layers |
| Markers | HTML markers with the class `georef-gcp-marker` and the point label; draggable while matching points |
| Drawing | Terra Draw layers prefixed `georef-…-draw`, only while drawing tools are in use |
| Events | `click`, `moveend` and `styledata` on the map, `keydown` (Escape cancels a pending pair) on the container |
| Cursor | Crosshair on the canvas container while a map click places a control point |

Layers are added once the style has loaded, and again after you replace the style with
`map.setStyle()`. Control points are HTML markers, so the style needs no glyphs.
`detach()` removes everything listed here, restores the cursor and resets the preview
CRS.

## Drawing

When the controller enables `digitizing`, the drawing tools use Terra Draw, loaded on
first use. Finished sketches become controller features with stable IDs in
longitude/latitude; the modify tool loads the current drafts into Terra Draw and commits
each edit. Without the optional peers, choosing a drawing tool reports an error and the
rest of the editor keeps working.

## PDF reports

```ts
import { pdf } from "@georeferencing/plugins/pdf";
import { captureMapLibreMap } from "@georeferencing/maplibre";

const formats = [pdf({ capture: () => captureMapLibreMap(map) })];
```

The capture is taken during the next render, so it works without
`preserveDrawingBuffer`; tile sources must allow CORS. The second argument overrides
the attribution text, which defaults to the map's attribution control.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| The map stays blank and a worker error is logged | `setWorkerUrl` is called before the map is created |
| Markers appear away from where you clicked | `maplibre-gl/dist/maplibre-gl.css` is imported |
| The overlay is drawn above labels | Set `beforeId` to the first label layer |
| Reference data does not appear | The WFS returns GeoJSON; the provider's `onReferenceStatus` and the editor's reference panel show errors |
| Drawing tools report missing dependencies | `terra-draw` and `terra-draw-maplibre-gl-adapter` are installed |
| The PDF report has no map page or fails | `capture` is passed to `pdf()`; tile sources allow CORS |

## License

[MIT](https://github.com/tobilg/georeferencing/blob/main/LICENSE)
