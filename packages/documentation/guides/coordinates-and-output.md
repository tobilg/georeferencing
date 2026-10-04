---
title: Coordinates and raster output
---

# Coordinates and raster output

## Coordinate spaces

| Space | Convention |
| --- | --- |
| Image GCP | Original resolution after EXIF orientation normalization; top-left corner `(0, 0)`, y down, first pixel centre `(0.5, 0.5)` |
| Reference target | A coordinate snapshot with its own `Gcp.crs`; later reference refreshes cannot move it |
| Working | Explicit document CRS for fitting, residuals and preview |
| Map view | Host OpenLayers view projection, independent of the working CRS |
| Raster output | Explicit `document.output.crs`, resolution and bounds |
| Feature output | RFC 7946 longitude/latitude by default, regardless of map projection |

Tuples use x/y order internally. WFS wire axis order is configured separately. An initial map bounding box only frames the map. Reference query bounds, geographic drawing bounds and output raster bounds are independent settings.

Register custom definitions with the OpenLayers binding and pass the same definitions to the worker engine. Required datum grids are supplied as NTv2 bytes through `datumGrids`; the package does not download them. EPSG:4326 and EPSG:3857 are built in, but a random EPSG identifier does not load its definition. Geographic wrap/polar cases outside the supported domain produce errors instead of silent coordinate substitution.

## Transformation models and diagnostics

| Model | Minimum enabled pairs | Behavior |
| --- | ---: | --- |
| Linear | 2 | Translation and axis scales using QGIS conventions |
| Helmert | 2 | Translation, uniform scale and rotation |
| Polynomial 1 | 3 | Affine |
| Polynomial 2 | 6 | Second degree |
| Polynomial 3 | 10 | Third degree |
| Projective | 4 | Homography |
| Thin plate spline | 3 | Radial interpolation with affine terms |

Count alone does not establish validity. Duplicate pairs, deficient rank, poor conditioning, folds, poles and unstable inverses can invalidate a fit. The current hard limit is 128 enabled points. TPS uses a three-point nondegenerate minimum in this implementation; the [capabilities and limits](https://github.com/tobilg/georeferencing/blob/main/packages/documentation/guides/capabilities.md) describes the baseline and deliberate validation differences.

`fitTransform` is a numerical API: callers must project all target coordinates to the same working CRS first. The worker's fit operation performs that conversion for you. Use `validateDomain` before rendering direct numerical fits; its sampled checks are not a proof of global injectivity.

For each enabled GCP, forward residual is `T(image) - target`, and RMSE is `sqrt(sum(distance²) / enabledCount)` in working-CRS units. Pixel residual is the distance from the backward-mapped target to the original source point. Polynomial backward mapping uses a separately fitted reverse polynomial to follow GDAL/QGIS raster behavior; it is generally not the exact inverse of the forward polynomial. Preview and export share this convention. Training residuals do not establish independent positional accuracy.

## Export and interchange

With `geoTiff()` registered in `exports`, `controller.exportRaster()` returns the GeoTIFF Blob, raster metadata/pixels and exact document snapshot used for processing. It returns null for cancellation, stale results or reported processing failures. Invalid fits and concurrent exports reject before starting. `onExport` on the ready-made editor replaces its default download with a host callback.

GeoTIFF output is north-up, 8-bit RGB with numeric no-data or RGBA with unassociated alpha, using PixelIsArea. Bounds describe outer pixel edges; row zero is at maxY. Supported codecs are uncompressed, Deflate and PackBits. Predictor 2 requires Deflate. Numeric no-data cannot preserve partial transparency. Classic TIFF is limited to below 4 GiB and this encoder requires an EPSG code below 32767; arbitrary WKT GeoKeys and BigTIFF are not implemented.

Resolution is a positive x/y pixel size in output-CRS units. Without an explicit value, the engine estimates pixel area at the transformed image centre. Bounds default to sampled/adaptively subdivided transformed image bounds. Right/bottom edges may expand to fit whole pixels. Pixel and estimated-memory budgets apply before output allocation.

With the `worldFile()` plugin registered, `exportWorldFile()` is eligible for Linear/Helmert without reprojection. It returns an orientation-normalized full-resolution PNG, six-line world file and explicit CRS. The last two world-file values locate the first pixel centre; the file itself carries no CRS.

`exportPoints` from `@georeferencing/plugins/serializers` and `importPoints` from `@georeferencing/core` round-trip QGIS `.points` coordinates and enabled state. QGIS's source y is negated to/from canonical y-down pixels. `.points` does not preserve IDs or provenance and exported residual columns are zero placeholders; use `accuracyReport` from the same serializers entry point for actual diagnostics and JSON sessions for full state.

`featuresInCrs` converts valid geographic features to an explicitly named `ProjectedFeatureCollection`. Its coordinates are not RFC 7946 GeoJSON. Adaptive subdivision uses a positive tolerance in destination units and preserves IDs/properties.

`createPdfReport` from `@georeferencing/plugins/report` generates a local PDF with diagnostics and an embedded full-precision JSON attachment. Supply a document, fit and raster for the same alignment revision. Optional map capture uses only currently loaded canvas layers, preserves the host view and requires CORS-safe image sources; it does not wait for all outstanding tiles or capture arbitrary DOM overlays.

JPEG and configurable format selection are described in [optional export plugins](./export-plugins.md).
