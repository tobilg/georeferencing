---
group: Guides
title: Map adapters
---

# Map adapters

The editor works with an existing, host-owned map through a **map adapter**. The
controller, the engine, the export plugins and the React editor do not depend on a map
library; an adapter connects one controller to one map. Three adapters are available:

| Adapter | Package | Map library peer |
| --- | --- | --- |
| OpenLayers | `@georeferencing/openlayers` | `ol` `>=10.10.0 <11` |
| MapLibre GL JS | `@georeferencing/maplibre` | `maplibre-gl` `>=6.0.0 <7` |
| Leaflet | `@georeferencing/leaflet` | `leaflet` `^1.9.4` |

Install the adapter for your map library next to `@georeferencing/core` (and
`@georeferencing/react` for the ready-made editor), all in the same version.

## Choose an adapter

| Capability | OpenLayers | MapLibre GL | Leaflet |
| --- | --- | --- | --- |
| Map projection | Any CRS with a proj4 definition | Web Mercator | Web Mercator, or a Proj4Leaflet CRS with its definition |
| Preview overlay | Working CRS, reprojected by OpenLayers | Rendered in EPSG:3857 | Rendered in the map CRS |
| Control-point picking, dragging and snapping | Yes | Yes | Yes |
| Drawing points, lines and polygons | Native interactions | Terra Draw (optional peer) | Terra Draw (optional peer) |
| WFS references (GeoJSON) | Yes | Yes | Yes |
| WFS references (GML) | Yes | No | No |
| Layers already owned by the host | `existing-vector` | No | No |
| Linked image/map navigation, map history | Yes | Yes | Yes |
| Map page in PDF reports | Yes | Yes | No |

Fitting, residuals and raster exports always use the document's working CRS; the
adapter only decides how results are displayed. MapLibre and Leaflet can only place
rectangular raster overlays in their display projection, so their adapters call
`controller.setPreviewCrs()` to get previews rendered in that projection; exports are
unaffected.

## Use an adapter with the React editor

[React and map libraries](./react-integration.md) has a complete
integration for each library.

Every adapter package exports a factory that returns a `MapAdapter`. Pass it to the
editor's `map` prop and create it **once** per map, for example with `useMemo`: a new
adapter object detaches and re-attaches the editor.

```tsx
const adapter = useMemo(() => openLayers(olMap, { references }), [olMap]);
const adapter = useMemo(() => maplibre(mapLibreMap, { references }), [mapLibreMap]);
const adapter = useMemo(() => leaflet(leafletMap, { lib: L, references }), [leafletMap]);

<Georeferencer controller={controller} map={adapter} definitions={definitions} />
```

All adapters share these options (`MapAdapterOptions` in `@georeferencing/core/map`):
`references`, `definitions`, `datumGrids`, `debounceMs`, `initialView`,
`digitizingSnapping` and `onReferenceStatus`. Without React, call the attach functions
directly (`attachReferenceMap`, `attachMapLibre`, `attachLeaflet`) and `detach()` the
returned binding when done; see [using core without React](./core-usage.md).

## OpenLayers

`openLayers(map, options)` is the most complete adapter: it displays any projection,
reads WFS GML as well as GeoJSON, can snap to vector layers the host already owns
(`kind: "existing-vector"`) and draws with native OpenLayers interactions. Register
projection definitions and datum grids with `registerProjections` (the adapter does this
for its own `definitions`). For PDF reports, pass
`pdf({ capture: () => captureOpenLayersMap(map) })`.

## MapLibre GL JS

`maplibre(map, options)` adds GeoJSON and image sources with layers prefixed `georef-`,
HTML markers for control points, and re-adds its layers when the host replaces the
style. `beforeId` inserts its layers below an existing style layer, for example below
labels. Previews are rendered in EPSG:3857; the working CRS can still be any CRS with a
definition.

MapLibre loads its web worker relative to its own module, and bundlers such as Vite do
not emit that file on their own. Set the worker URL explicitly; with Vite this works in
development and production builds:

```ts
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

setWorkerUrl(workerUrl);
```

`captureMapLibreMap(map)` captures the map
during the next render, without `preserveDrawingBuffer`; tile sources must allow CORS.

## Leaflet

`leaflet(map, { lib: L, ... })` takes the Leaflet module as `lib` instead of importing it,
so the adapter package stays importable during server-side rendering and works with a
Leaflet loaded as a global. Previews are rendered in the map CRS
(`map.options.crs.code`): Web Mercator by default, or a Proj4Leaflet CRS whose definition
you pass in `definitions`. `L.CRS.Simple` maps are not supported. Leaflet renders tiles as
DOM images, so PDF reports from a Leaflet map omit the map page.

## Drawing with Terra Draw

The MapLibre and Leaflet adapters draw with [Terra Draw](https://terradraw.io). It is an
optional peer: install `terra-draw` and `terra-draw-maplibre-gl-adapter` or
`terra-draw-leaflet-adapter` when the controller enables `digitizing`. Terra Draw loads on
first use of a drawing tool. Finished sketches become controller features with stable
IDs and longitude/latitude coordinates; the modify tool loads the current drafts into
Terra Draw and commits every edit. Without the peers, choosing a drawing tool reports an
error and the rest of the editor keeps working.

## Write your own adapter

An adapter is a function from a controller to a `MapBinding`. A binding needs
`detach`, `fitOverlay` and `cancelDrawing`; optional members are capabilities that the
React editor uses when present (`resize`, `finishDrawing`, `navigateHistory`,
`capture`). `@georeferencing/core/map` provides the building blocks the bundled adapters
use:

| Helper | Purpose |
| --- | --- |
| `subscribeBinding` | Render every controller snapshot and report errors without feedback loops |
| `watchReferences`, `loadReferenceData` | Debounced, cancellable reference loading with status reporting, as longitude/latitude GeoJSON |
| `snapToReferences` | Vertex and edge snapping in screen pixels |
| `imageViewToExtent`, `extentToImageView` | Linked image/map navigation |
| `ViewHistory` | Bounded back/forward view history |
| `sharedProj4` | The proj4 instance core converts with, for map libraries that integrate proj4 |

This minimal adapter for a hypothetical map library picks control points and shows their
markers:

{@includeCode ../examples/custom-adapter.ts}

Use `controller.setPreviewCrs(crs)` when your map can only show raster overlays in its
display projection, and reset it to `null` on detach.

## Migrating from 0.3

Before 0.4.0 the OpenLayers integration shipped inside core:

| Before | Now |
| --- | --- |
| `@georeferencing/core/openlayers` | `@georeferencing/openlayers`; shared reference types and WFS discovery in `@georeferencing/core/map` |
| `<Georeferencer referenceMap={map} bindingOptions={options} />` | `<Georeferencer map={openLayers(map, options)} definitions={options.definitions} />` |
| `pdf({ map })` | `pdf({ capture: () => captureOpenLayersMap(map) })` |
| `ol` peer of core and React | `ol` peer of `@georeferencing/openlayers` only |
