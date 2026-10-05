---
group: Guides
title: React and map libraries
---

# React and map libraries

The React editor works the same way with every map library: you create the map, wrap
it in the library's adapter and pass the adapter to `Georeferencer`. This guide shows a
complete integration for each library and the patterns they share. For the general
setup (controller, engine, exports and saving), start with
[getting started](./getting-started.md).

## Install

| Map library | Packages |
| --- | --- |
| OpenLayers | `@georeferencing/openlayers ol` |
| MapLibre GL JS | `@georeferencing/maplibre maplibre-gl`, plus `terra-draw terra-draw-maplibre-gl-adapter` for drawing |
| Leaflet | `@georeferencing/leaflet leaflet`, plus `terra-draw terra-draw-leaflet-adapter` for drawing |

Install them next to `@georeferencing/core`, `@georeferencing/react`, `react` and
`react-dom`, all `@georeferencing/*` packages in the same version:

```sh
pnpm add @georeferencing/core @georeferencing/react @georeferencing/maplibre maplibre-gl react react-dom
```

## Create the map inside the editor

In the guided layout, the map's container is part of the editor: you pass it as
`referenceView`, and the editor decides where to show it. The map can only be created
once that container is in the page, but the editor needs an adapter already when it
first renders.

The `useHostMap` hook below solves this. It returns a ref for the map container and a
stable adapter for the editor. React attaches refs before it runs effects, so the map
exists by the time the editor attaches the adapter. When the container unmounts, the
hook disposes the map only after the editor has detached from it. Copy it into your
project:

{@includeCode ../examples/use-host-map.ts}

Keep the function that creates the map stable, for example at module level as in the
examples below. A new function creates a new map. The hook also works in the classic
layout (without `referenceView`), as long as the container renders together with the
editor. If your map already exists, skip the hook and create the adapter with
`useMemo(() => maplibre(map, options), [map])`.

## OpenLayers

{@includeCode ../examples/react-openlayers.tsx}

- Import `ol/ol.css` for the map controls.
- A focusable map target (`tabIndex`) makes OpenLayers ignore mouse panning and wheel
  zoom until the map has focus. Create the map with
  `interactions: defaults({ onFocusOnly: false })` so both work immediately.
- The map may use any projection that proj4 knows. Pass custom `definitions` to the
  adapter options and the engine.
- For PDF reports with a map page, use `captureOpenLayersMap(map)`.

## MapLibre GL JS

{@includeCode ../examples/react-maplibre.tsx}

- Import `maplibre-gl/dist/maplibre-gl.css`; without it, control-point markers are
  placed incorrectly.
- Set the worker URL once before creating maps. Bundlers do not emit MapLibre's worker
  on their own; the example shows the Vite syntax.
- Previews are rendered in Web Mercator while the adapter is attached, whatever the
  working CRS.
- Pass `beforeId` in the adapter options to insert the editor's layers below an
  existing style layer, such as labels. The layers come back automatically when you
  call `map.setStyle()`.
- For PDF reports with a map page, use `captureMapLibreMap(map)`.

## Leaflet

{@includeCode ../examples/react-leaflet.tsx}

- Import `leaflet/dist/leaflet.css`.
- Pass the Leaflet module as `lib`: the adapter never imports Leaflet itself, because
  Leaflet accesses `window` when it is imported.
- Previews are rendered in the map CRS, Web Mercator by default. Proj4Leaflet maps need
  their CRS definition in `definitions`; `L.CRS.Simple` is not supported.
- Leaflet renders tiles as DOM images, so PDF reports from a Leaflet map have no map
  page.

## Configure the adapter

All adapters take the same core options, plus a few of their own:

```ts
const adapter = maplibre(map, {
  references: [
    {
      kind: "geojson",
      id: "parcels",
      label: "Parcels",
      data: parcels,
      crs: "EPSG:4326",
      snapping: { vertices: true, edges: true, tolerancePx: 12 },
    },
  ],
  definitions: { "EPSG:25832": "+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs" },
  digitizingSnapping: { references: true, drafts: true },
  onReferenceStatus: (id, status) => console.debug(id, status),
});
```

| Option | OpenLayers | MapLibre | Leaflet |
| --- | --- | --- | --- |
| `references`: `wfs` (GeoJSON), `geojson`, `custom` | Yes | Yes | Yes |
| `references`: `wfs` with GML, `existing-vector` | Yes | No | No |
| `definitions`, `datumGrids`, `initialView`, `debounceMs`, `digitizingSnapping`, `onReferenceStatus` | Yes | Yes | Yes |
| Library-specific | `geometryTolerancePx` | `beforeId` | `lib` (required) |

The adapter reads its options once when it attaches. Create them together with the map,
or memoize them: a changed options object only takes effect with a new adapter. See
[reference data](./reference-data.md) for WFS and custom loaders.

## Own the session

The host creates the controller and engine, keeps them across renders and disposes
them when the user is done. Never dispose them in an effect cleanup: React Strict Mode
runs cleanups during development while the editor stays in use. This example creates a
session on demand, includes the map page in PDF reports, and disposes the session after
the editor has unmounted:

{@includeCode ../examples/react-session.tsx}

The PDF `capture` callback reads the current map when the report is created. With
OpenLayers use `captureOpenLayersMap(map)`; with Leaflet omit `capture`.

## Drawing

With `digitizing: true` on the controller, the export step offers point, line and
polygon tools after the alignment is confirmed. OpenLayers draws with its own
interactions. MapLibre and Leaflet use [Terra Draw](https://terradraw.io), loaded when
a drawing tool is first chosen; install `terra-draw` and the adapter package for your
map library. Without them, choosing a drawing tool shows an error and the rest of the
editor keeps working.

## Build your own layout

The panels (`ImagePanel`, `GcpPanel`, `AlignmentPanel`, `ReferencePanel`,
`FeaturePanel`) do not attach a map. Attach the adapter yourself and suspend the
controller on cleanup:

```tsx
useEffect(() => {
  controller.start();
  const binding = adapter(controller);
  return () => {
    binding.detach();
    controller.suspend();
  };
}, [adapter, controller]);
```

Use `useHostMap` for the map as above; its adapter stays the same across renders. Keep
the returned binding if your layout offers "fit to image" (`binding.fitOverlay()`) or
map history buttons. See [using core without React](./core-usage.md) for the
controller methods behind each step.

## Sizing and layout

The editor calls the binding's `resize()` when it shows the map on small screens. If
your layout changes the map container's size in other ways, tell the map:
`map.updateSize()` for OpenLayers, `map.resize()` for MapLibre and
`map.invalidateSize()` for Leaflet. Give the container an explicit height; the editor
does not size it.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| "The map container is not mounted." | The editor attached before the map container rendered; render the container in `referenceView` or in the same render as the editor |
| The editor re-attaches on every render | The adapter or its options are recreated; use `useHostMap`, `useMemo` or module-level options |
| MapLibre shows no map and logs a worker error | The worker URL is not set; call `setWorkerUrl` before creating maps |
| MapLibre markers appear far from where you clicked | `maplibre-gl.css` is not imported |
| OpenLayers ignores dragging and the mouse wheel | The map target is focusable; use `defaults({ onFocusOnly: false })` |
| Drawing tools report missing dependencies | Install `terra-draw` and the Terra Draw adapter for your map library |
| The PDF report has no map page | Leaflet maps cannot be captured; with other libraries, check `capture` and CORS on tile sources |
