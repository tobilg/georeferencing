---
title: Reference data
---

# Reference data

Configure reference sources in a stable `BindingOptions` object. Reuse the host's actual endpoint, type names, projection definitions and authentication. The following factory takes those values as arguments rather than assuming a public service:

{@includeCode ../examples/references.ts}

The WFS example explicitly assumes projected xy request/response coordinates. Change request/response axis settings for your service. `queryBounds` constrains viewport requests after projection; an empty intersection skips loading. `loading: "fixed"` requires configured bounds. `initialView` is a separate map-framing option.

WFS 2.0 uses `count` and `startIndex`. WFS 1.1 uses `maxFeatures`; enable `supportsStartIndex` only for services supporting that extension, or supply discovered capabilities. Responses are bounded by page, feature and byte budgets. Repeated pages, missing paging support and mismatched service counts are exposed as partial results. Stable feature IDs are required; configure `idProperty` when the service omits IDs.

`axisOrder` controls BBOX wire order. `responseAxisOrder` separately overrides returned coordinate order. `responseCrs` overrides a service declaration; without it the loader prefers the declared response CRS and then the requested CRS. Register all required projections before loading. Both GeoJSON and version-appropriate GML are supported. HTTP errors, malformed responses and HTTP-200 OGC exception documents are errors.

The host `request(url, init)` adapter can inject credentials or headers. Preserve `init.signal`; viewport navigation and detach cancel requests. Request credentials are runtime configuration and are not part of a serializable document.

## Borrowed layers, static data and custom loaders

A borrowed layer's existing source supplies reference geometry without additional requests. The package does not add/remove the layer, clear its source or dispose it. The host remains responsible for its loading and projection.

Use `kind: "geojson"` with `data` and an explicit `crs` for static reference features. Use `kind: "custom"` with `queryCrs`, optional `queryBounds`, and `load(query)` for other services. The query carries bounds in queryCrs, current map resolution in map units per pixel, and an AbortSignal. Return `{ data, crs, partial, message? }`; the binding projects the response and ignores results from superseded requests even when a custom loader does not cooperate with cancellation.

Optional `discoverWfs` and `describeWfsFeatureType` helpers perform read-only capabilities/schema requests. Explicit host configuration remains supported; discovery is not a prerequisite for manual target entry.

## Snapping and feedback

Supplying a provider's `snapping` object opts it into GCP snapping. Vertices default on, edges off, and tolerance to 10 screen pixels. Drawing snapping is independently enabled through `digitizingSnapping.references` and `.drafts`.

Provider loading state, errors and completeness appear in `EditorSnapshot.references`, `ReferencePanel`, and the optional `onReferenceStatus` callback. Reference errors do not disable manual coordinate entry. Selected targets are coordinate snapshots: refreshing source geometry cannot move previously recorded GCPs.
