# @georeferencing/react

React 19 components and hooks for georeferencing local images on an existing
OpenLayers map. This package provides the ready-made editor, composable panels,
subscription hook, unsaved-work dialog and scoped styles.

The authoritative session and processing engine live in
[`@georeferencing/core`](https://github.com/tobilg/georeferencing/tree/main/packages/core).
Optional exports come from
[`@georeferencing/plugins`](https://github.com/tobilg/georeferencing/tree/main/packages/plugins).
React has no runtime dependency on plugins or pdf-lib: it displays formats
configured on the controller.

## Installation and compatibility

```sh
pnpm add @georeferencing/core @georeferencing/react react@19 react-dom@19 ol@10
# Optional output formats:
pnpm add @georeferencing/plugins
# TypeScript React applications also need the React declarations:
pnpm add -D @types/react@19 @types/react-dom@19
```

Verified peer ranges are React/React DOM `>=19.3.0 <20` and OpenLayers
`>=10.10.0 <11`. The host owns these libraries and its map. Packages ship ESM and
TypeDoc-bearing TypeScript declarations. Node.js 22.12+ is the declared tooling
requirement; the repository uses pnpm 12.x.

Importing the package is SSR-safe. Create maps and start browser processing only
on the client.

**Install the same version of `@georeferencing/react`, `@georeferencing/core` and
`@georeferencing/plugins`**, and upgrade them together. React depends on core and
re-exports its controller; a mismatched version can install a second copy of core
with a separate projection registry. See
[keep package versions aligned](https://georeferencing-api-docs.gh.tobilg.com/Getting_started/#keep-package-versions-aligned).

## Integrate with a host-owned map

The map must already have a visible target, dimensions and initialized view. Make
one stable controller/engine per session, and inject your real save service.
This example needs no export plugin and sends geographic features to the host.

```tsx
import type { ControllerOptions } from "@georeferencing/core";
import { GeoreferencerController } from "@georeferencing/core";
import { createWorkerEngine } from "@georeferencing/core/engine";
import { Georeferencer } from "@georeferencing/react";
import type OLMap from "ol/Map.js";
import "ol/ol.css";
import "@georeferencing/react/styles.css";

export function createEditorSession(
  workingCrs: string,
  persistFeatures: NonNullable<ControllerOptions["onSave"]>,
  persistDraft?: ControllerOptions["onSaveDraft"],
) {
  const engine = createWorkerEngine();
  const controller = new GeoreferencerController({
    workingCrs,
    engine,
    digitizing: true,
    onSave: persistFeatures,
    onSaveDraft: persistDraft,
  });
  return {
    controller,
    dispose() {
      controller.dispose();
      engine.dispose();
    },
  };
}

export function ImageEditor({
  map,
  session,
}: {
  map: OLMap;
  session: ReturnType<typeof createEditorSession>;
}) {
  return <Georeferencer controller={session.controller} referenceMap={map} />;
}
```

The host calls `createEditorSession` once, for example when opening an editor,
and retains it across renders. Render `ImageEditor` only after the host map exists.
On permanent close, resolve unsaved work, unmount the editor, then dispose the
session. A temporary detach/remount must retain the same controller.

With Vite, use ES module workers:

```ts
export default { worker: { format: "es" } };
```

The stylesheet is optional. It uses `rg-` classes; the host controls map layout
and dimensions. Core's engine and each optional codec support explicit worker
URLs/factories for deployments that do not preserve default bundled asset paths.

## Ready-made editor props

| Prop | Contract |
| --- | --- |
| `controller` | Required stable authoritative session controller |
| `referenceMap` | Required initialized, host-owned OpenLayers map |
| `bindingOptions` | Stable reference providers, projections, snapping and optional initial map framing |
| `t` | Translate default English text, including configured format labels |
| `formatError` | Format structured errors by code/message/operation ID |
| `className` | Additional editor root class |
| `propertyEditor` | Host feature-property form; update replacement JSON properties |
| `onExport` | Receive any configured format's artifacts instead of automatic downloads |

Memoize `bindingOptions` or construct it outside rendering. Changing its identity
reattaches the binding. The ready-made component owns its attachment; do not also
call `attachReferenceMap` for the same controller and map.

## Select exports on demand

No format is enabled implicitly. Configure the controller at creation or replace
its registry at runtime:

```ts
import type { GeoreferencerController } from "@georeferencing/core";
import { geoTiff } from "@georeferencing/plugins/geotiff";
import { jpeg } from "@georeferencing/plugins/jpeg";
import { pdf, type ReportMap } from "@georeferencing/plugins/pdf";

export function enableExports(
  controller: GeoreferencerController,
  currentMap: () => ReportMap | undefined,
) {
  controller.setExportFormats([
    geoTiff(),
    jpeg({ quality: 0.92 }),
    pdf({ map: currentMap }),
  ]);
}
```

The UI shows only these actions. `setExportFormats` replaces the registry and
cancels active export work. Import a subset to exclude unused implementations
from the browser bundle; heavy format code loads on request.

The default UI downloads every artifact. `onExport(result)` can handle them in
host code; inspect `result.format`, `result.document` and each `{ name, blob }`
in `result.files`. JPEG and world-file exports include required CRS/placement
sidecars. Export completion never acknowledges host persistence. See the
[plugins README](https://github.com/tobilg/georeferencing/blob/main/packages/plugins/README.md)
for format settings, cancellation and limits.

## Guided matching and preview policy

The Hamburg demo uses `previewMode: "manual"` in its core controller. The visible
**Preview updates** selector changes that policy through `setPreviewMode`.
`PreviewControls` is also exported for custom layouts; it displays minimum-point
readiness and an explicit **Run alignment** action. Worker validation reports
singular or unusable arrangements when a run is requested. Automatic mode updates
eligible previews after committed edits without advancing the user's review step.

Supply `referenceView` to `Georeferencer` to opt into the guided layout. It is a
React node containing the host's map target and optional map controls; the host
still owns the map and must attach its target before editor effects run (a React
callback ref is suitable). Without this prop, the existing panel layout remains.
See the [complete demo host](https://github.com/tobilg/georeferencing/blob/main/packages/demo/main.tsx)
for a typed integration with target attachment and cleanup.

The guided layout automatically starts image-first/map-second matching after an
accepted image load, announces the next endpoint, supports Escape to cancel an
incomplete pair, and keeps both views side by side on desktop. Below 720 px,
image/map buttons switch the visible pane and follow pending pairs without
unmounting either viewer. The sticky run toolbar remains accessible while editing
the point table. After running, review the overlay and residuals, edit/rerun as
needed, then export or explicitly accept alignment to draw. Drawing controls are
shown after acceptance; session files remain available during unfinished work.

`AlignmentPanel` accepts `controls={false}` when transformation and preview
controls are already rendered elsewhere. `PreviewControls.onReview` is called
only for a successful preview matching the requested document/alignment revision.
These panels never take map or engine ownership.

## References, projections and snapping

Pass core's `BindingOptions` as `bindingOptions`. Providers include bounded
viewport WFS, static GeoJSON, custom abortable loaders and borrowed vector layers.
A borrowed layer retains its host loading and ownership. Reference errors and
partial results appear in the UI without disabling manual target entry.

Configure real endpoint/type names, request/response CRSs and axis conventions.
Preserve AbortSignal when injecting authentication. Query bounds limit reference
loading; `initialView` only frames the map. Neither georeferences the image.
Drawing bounds and raster bounds are independent.

Register the same custom projection definitions and NTv2 grids with the engine
and binding. Image GCPs use original-resolution, orientation-normalized pixels;
feature drafts/save payloads use longitude/latitude regardless of the map view.
Supplying provider `snapping` opts into GCP snapping. Drawing snapping is separately
controlled by `digitizingSnapping.references` and `.drafts`. The
[reference guide](https://github.com/tobilg/georeferencing/blob/main/packages/documentation/guides/reference-data.md)
contains typed provider examples.

## Image lifecycle, confirmation and saving

The image picker and drop zone use controller lifecycle methods. Selection supports
files up to 25 MiB, subject to decoded-pixel and memory budgets. Replacing/removing
an image invokes the ready-made Save/Discard/Cancel dialog when needed, cancels
old processing and preserves the host map view. Original bytes stay outside the
serializable document. Restoring a JSON session requires the matching source file.

Digitizing is opt-in through `digitizing: true`. A valid current alignment must be
explicitly confirmed before drawing multiple points, lines or polygons. Features
can be modified, deleted and undone/redone. Returning to alignment leaves them
geographically anchored; subsequent alignment changes require confirmation and
explicit feature review before saving accepted features again.

`onChange` mirrors draft state. `onSave` receives an immutable accepted-feature
envelope with stable IDs, source fingerprint, alignment and provenance.
`onSaveDraft` can persist unfinished sessions separately. A save callback resolves
after actual storage success and rejects on failure; a failed draft remains
retryable. Older save completion does not acknowledge newer edits. Feature saving
never requires raster export. Hosts must separately persist source bytes and
protect route/window closure; the image-transition dialog is not a general router
or browser-close guard.

## React Strict Mode and ownership

The editor resumes the controller during setup and suspends it during cleanup.
It adds/removes only package-owned map layers/interactions. It does not dispose
the host map, borrowed layers, controller or engine on unmount. This permits
React 19 Strict Mode setup/cleanup cycles and later remounts.

Use permanent `dispose()` only after the host has finished with the session;
do not put it in an effect cleanup that Strict Mode uses for temporary teardown.
Host interactions remain host-owned. Use `onActiveToolChange` in controller options
to coordinate conflicting host drawing tools explicitly. Pending host saves are
revision-safe but are not cancelled by UI suspension.

## Compose a custom UI

| Export | Purpose |
| --- | --- |
| `Georeferencer` | Complete editor, map attachment, guard dialog and output controls |
| `useGeoreferencer(controller)` | Subscribe to the authoritative snapshot |
| `ImagePanel` | Image selection, image view and image-side GCP interaction |
| `GcpPanel` | Paired-point table, numeric editing and diagnostics |
| `PreviewControls` | Manual/automatic preview policy, readiness and explicit run/review |
| `AlignmentPanel` | Transformation selection, confirmation and alignment controls |
| `ReferencePanel` | Reference loading/error/incomplete-result feedback |
| `FeaturePanel` | Drawing tools, features/properties, review and save controls |

Composable panels do not install a map binding or unsaved-work dialog. Supply a
controller with a host `guard`, attach the map once and manage suspension yourself:

```tsx
import type { GeoreferencerController } from "@georeferencing/core";
import { attachReferenceMap, type BindingOptions } from "@georeferencing/core/openlayers";
import {
  AlignmentPanel, FeaturePanel, GcpPanel, ImagePanel,
  ReferencePanel, useGeoreferencer,
} from "@georeferencing/react";
import type OLMap from "ol/Map.js";
import { useEffect } from "react";

export function CustomEditor({ map, controller, options }: {
  map: OLMap;
  controller: GeoreferencerController;
  options: BindingOptions;
}) {
  const state = useGeoreferencer(controller);
  useEffect(() => {
    controller.start();
    const binding = attachReferenceMap(map, controller, options);
    return () => {
      binding.detach();
      controller.suspend();
    };
  }, [map, controller, options]);

  return (
    <div className="rg-editor">
      <ImagePanel controller={controller} />
      <GcpPanel controller={controller} />
      <AlignmentPanel controller={controller} />
      <ReferencePanel controller={controller} />
      <FeaturePanel controller={controller} />
      <p role="status">{state.error ?? `Document revision ${state.document.documentRevision}`}</p>
    </div>
  );
}
```

Custom layouts provide their own export/session actions through controller APIs.
Keep the `options` object stable. Omitting a headless guard safely cancels dirty
image transitions instead of silently discarding them.

## Localization and property forms

Use `t` for UI messages and `formatError` for structured dynamic errors. Business
properties remain host-defined JSON. Never mutate the frozen feature passed to
a property renderer; call its update callback with replacement properties.

```tsx
import type { GeoreferencerProps } from "@georeferencing/react";

export const propertyEditor: GeoreferencerProps["propertyEditor"] = (feature, update) => (
  <label>
    Name
    <input
      value={String(feature.properties.name ?? "")}
      onChange={(event) => update({ ...feature.properties, name: event.target.value })}
    />
  </label>
);

export const translate: NonNullable<GeoreferencerProps["t"]> = (message) => {
  const messages: Record<string, string> = { "Choose image": "Bild auswählen" };
  return messages[message] ?? message;
};
```

Pass these functions as props to `Georeferencer`, or to the relevant composable
panels. The package includes focusable map/image controls, labeled inputs and
status feedback; hosts remain responsible for accessible custom property editors,
layout, translations and their application's overall keyboard behavior.

## Source organization

`src/index.ts` defines the public exports. The editor lives in `Georeferencer.tsx`,
composable panels in `panels/`, the subscription hook in `hooks/`, shared fields
in `components/`, and download handling in `utils/`. Translation types/defaults
live in `localization.ts`. These internal modules preserve the public API; consumers
continue importing from `@georeferencing/react` and its `styles.css` entry.

## Troubleshooting and license

`@georeferencing/react` exposes `.` and `/styles.css`. Declarations carry TypeDoc
comments for editor help; the same comments are published as the
[API documentation](https://georeferencing-api-docs.gh.tobilg.com). Source, issues and contribution notes are in the
[GitHub repository](https://github.com/tobilg/georeferencing). MIT licensed.

| Symptom | Check |
| --- | --- |
| Blank map or missing overlay | Host map target/size, valid current fit and overlay visibility |
| Repeated reference loads / lost map interaction state | Stable controller, map and memoized binding options |
| Duplicate editor layers/interactions | Only one attachment per controller/map; avoid manual binding alongside `Georeferencer` |
| Drawing/save controls unavailable | Opt-in digitizing, valid confirmation, feature review and configured save handler |
| Export controls absent | Register the desired optional plugins |
| Worker or map-capture error | Worker URLs/CSP, supported browser APIs and CORS-safe map layers |
