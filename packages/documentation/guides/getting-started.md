---
title: Getting started
---

# Getting started

Install the library and its host-owned peers in your React application:

```sh
pnpm add @georeferencing/core @georeferencing/react @georeferencing/plugins react@19 react-dom@19 ol@10
```

npm and Yarn work the same way (`npm install …`, `yarn add …`). The verified peer ranges are React/React DOM `>=19.3.0 <20` and OpenLayers `>=10.10.0 <11`. Install the same version of all `@georeferencing/*` packages; see [keep package versions aligned](#keep-package-versions-aligned).

Core and React require no export plugins. The example opts into three formats; omit `exports` and the plugins dependency for alignment and saving alone. See [optional export plugins](./export-plugins.md).

## Attach to an existing map

Create one controller and engine for each editor session. Keep them stable across renders. The map must already have a visible target and an initialized view. Select a working CRS appropriate to your data; it may differ from the map projection.

{@includeCode ../examples/integration.tsx}

The host calls `createEditor` once for a session and renders `ImageEditor` with its existing map and the returned controller. The save functions in this example are injected host services, not simulated persistence. Resolve them only after your storage has accepted the snapshot.

The component attaches its own OpenLayers binding. On unmount it detaches package layers/interactions and suspends processing while retaining the session. When the host permanently closes the session, unmount the editor and then call the returned `dispose`. Do not permanently dispose retained resources during React Strict Mode's temporary effect cleanup.

The stylesheet is optional and scoped. The host sets the map element's dimensions and imports `ol/ol.css` for its own map controls.

## Compose your own UI

The `ImagePanel`, `GcpPanel`, `AlignmentPanel`, `ReferencePanel` and `FeaturePanel` components share the same controller. `useGeoreferencer(controller)` subscribes to its snapshot without taking resource ownership. Use `attachReferenceMap` once, call its `detach()` during cleanup, and call `controller.start()`/`controller.suspend()` at your component lifecycle boundaries. Configure a `guard` callback for unsaved changes: composable panels do not install the ready-made editor's dialog.

Pass `t(message)` to translate default English UI text. The ready-made editor also accepts `formatError` for error-code localization and `propertyEditor(feature, update)` for a host-specific property form. Call `update` with replacement JSON properties; frozen feature snapshots must not be mutated.

See [lifecycle and saving](./lifecycle-and-saving.md) before integrating persistence, and [worker deployment](./workers-and-deployment.md) before building your production bundle.

## Keep package versions aligned

`@georeferencing/core`, `@georeferencing/plugins` and `@georeferencing/react` are
released together with identical version numbers. Always install the **same
version** of every `@georeferencing/*` package your application uses, and upgrade
them together:

```sh
# Replace <version> with one release number, for example when upgrading:
pnpm add @georeferencing/core@<version> @georeferencing/plugins@<version> @georeferencing/react@<version>
```

Plugins and React declare core as a regular dependency. When the versions differ,
your package manager can install a second copy of core, which then also bundles
its own proj4 projection registry. The host's controller, map binding and export
plugins would no longer share registered projections or datum grids, and the
application ships the processing code twice. Check for a single copy with
`pnpm why @georeferencing/core` (or `npm ls @georeferencing/core`); a pnpm
`overrides` entry or npm `overrides` field can force one version if a transitive
dependency pulls in another.

## Guided matching and explicit preview

The [Hamburg demo](https://github.com/tobilg/georeferencing/blob/main/packages/demo/main.tsx)
starts with `previewMode: "manual"` on the core controller and passes the host map
view as `Georeferencer.referenceView`. Pick an image location, pick its map match,
and repeat. **Run alignment** fits and previews those pairs; export and optional
accepted drawing are separate actions.

Core defaults to `"automatic"` for existing integrations. Change the policy with
`controller.setPreviewMode(mode)`; it is transient configuration outside session
JSON. Automatic mode waits for enough enabled pairs before fitting; manual mode
also applies to undo/redo, restoration and remount. Neither mode bypasses worker
rank/domain checks or stale-revision protection. The React `PreviewControls`
component exposes this setting and a run/review button for custom layouts.

The guided layout announces the next endpoint, activates matching after load,
keeps both viewers visible on desktop, and uses Image/Map buttons below 720 px.
Edits invalidate the old preview and acceptance; manual mode requires another run.
The supplied WebP is decoded locally with the same size/orientation/memory checks
as other supported input formats.
