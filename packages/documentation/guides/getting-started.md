---
group: Guides
title: Getting started
---

# Getting started

Install the library, the adapter for your map library and the host-owned peers in your React application. This guide uses OpenLayers; [React and map libraries](./react-integration.md) has complete examples for every map library, and [using core without React](./core-usage.md) covers other UI frameworks:

```sh
pnpm add @georeferencing/core @georeferencing/react @georeferencing/plugins @georeferencing/openlayers react@19 react-dom@19 ol@10
```

npm and Yarn work the same way (`npm install …`, `yarn add …`). The verified peer ranges are React/React DOM `>=19.3.0 <20` and, for the OpenLayers adapter, OpenLayers `>=10.10.0 <11`. Install the same version of all `@georeferencing/*` packages; see [keep package versions aligned](#keep-package-versions-aligned).

Core and React require no export plugins. The example opts into three formats; omit `exports` and the plugins dependency for alignment and saving alone. See [optional export plugins](./export-plugins.md).

## Attach to an existing map

Create one controller and engine for each editor session. Keep them stable across renders. The map must already have a visible target and an initialized view. Create the map adapter once per map, for example with `useMemo`: a new adapter re-attaches the editor. Select a working CRS appropriate to your data; it may differ from the map projection.

{@includeCode ../examples/integration.tsx}

The host calls `createEditor` once for a session and renders `ImageEditor` with its existing map and the returned controller. To create the map inside the editor's guided layout instead, use the `useHostMap` pattern from [React and map libraries](./react-integration.md#create-the-map-inside-the-editor). The save functions in this example are injected host services, not simulated persistence. Resolve them only after your storage has accepted the snapshot.

The component attaches the adapter's binding. On unmount it detaches package layers/interactions and suspends processing while retaining the session. When the host permanently closes the session, unmount the editor and then call the returned `dispose`. Do not permanently dispose retained resources during React Strict Mode's temporary effect cleanup.

The stylesheet is optional and scoped. The host sets the map element's dimensions and imports `ol/ol.css` for its own map controls.

## Compose your own UI

The `ImagePanel`, `GcpPanel`, `AlignmentPanel`, `ReferencePanel` and `FeaturePanel` components share the same controller. `useGeoreferencer(controller)` subscribes to its snapshot without taking resource ownership. Attach the map once with your adapter (for example `openLayers(map, options)(controller)` or `attachReferenceMap`), call the binding's `detach()` during cleanup, and call `controller.start()`/`controller.suspend()` at your component lifecycle boundaries. Configure a `guard` callback for unsaved changes: composable panels do not install the ready-made editor's dialog.

Pass `t(message)` to translate default English UI text. The ready-made editor also accepts `formatError` for error-code localization and `propertyEditor(feature, update)` for a host-specific property form. Call `update` with replacement JSON properties; frozen feature snapshots must not be mutated.

See [lifecycle and saving](./lifecycle-and-saving.md) before integrating persistence, and [worker deployment](./workers-and-deployment.md) before building your production bundle.

## Keep package versions aligned

All `@georeferencing/*` packages (core, plugins, react and the map adapters) are
released together with identical version numbers. Always install the **same
version** of every `@georeferencing/*` package your application uses, and upgrade
them together:

```sh
# Replace <version> with one release number, for example when upgrading:
pnpm add @georeferencing/core@<version> @georeferencing/plugins@<version> @georeferencing/react@<version> @georeferencing/openlayers@<version>
```

Plugins, React and the map adapters declare core as a **peer dependency**: they always use the copy
your application installs, so the controller, map binding and export plugins share
one proj4 projection registry and one set of datum grids. Install core explicitly
alongside them (npm 7+ and pnpm also install missing peers automatically). When the
versions differ, the package manager reports a peer-dependency conflict instead of
silently installing a second copy. Check with `pnpm why @georeferencing/core` (or
`npm ls @georeferencing/core`); a pnpm `overrides` entry or npm `overrides` field can
force one version if a transitive dependency pulls in another.

## Guided four-step layout

Passing the host map view as `Georeferencer.referenceView` selects the guided
layout used by the [Hamburg demo](https://github.com/tobilg/georeferencing/blob/main/packages/demo/main.tsx):
**Load image → Match points → Check alignment → Export or draw**, with one main
action per step. It starts with minimal controls; enable expert controls one by one
with the `controls` prop, or pass `ALL_CONTROLS`:

```tsx
<Georeferencer
  controller={controller}
  map={adapter}
  referenceView={mapView}
  controls={{ transformation: true, pointTable: true, outputSettings: true }}
/>
```

The flags are `history` (on by default), `previewMode`, `transformation`,
`pointTable`, `manualEntry`, `navigation`, `displayAdjustment`, `referenceStatus`,
`outputSettings`, `sessionFiles` and `unsavedIndicator`. Enable `manualEntry` when
keyboard-only point entry is required. `emptyImageActions` adds buttons, such as a
sample image, to the empty drop zone. Without `referenceView`, the classic layout
shows every control.

Core defaults to `"automatic"` for existing integrations. Change the policy with
`controller.setPreviewMode(mode)`; it is transient configuration outside session
JSON. Automatic mode waits for enough enabled pairs before fitting; manual mode
also applies to undo/redo, restoration and remount. Neither mode bypasses worker
rank/domain checks or stale-revision protection. The React `PreviewControls`
component exposes this setting and a run/review button for custom layouts; the
guided layout shows its selector only with `controls={{ previewMode: true }}`.

The guided layout announces the next point, activates matching after load,
keeps both viewers visible on desktop, and uses Image/Map buttons below 720 px.
Both views pan by dragging and zoom with the mouse wheel; a click without
dragging places a point. Zoomed in beyond the reduced preview, the image view loads
the full-resolution image for precise placement. With OpenLayers, if your map target
has a `tabindex`, create the map with `interactions: defaults({ onFocusOnly: false })`
from `ol/interaction/defaults.js`: OpenLayers otherwise ignores mouse panning and wheel
zoom until the map has focus.
Edits invalidate the old preview and confirmation; manual mode requires another run.
The supplied WebP is decoded locally with the same size/orientation/memory checks
as other supported input formats.
