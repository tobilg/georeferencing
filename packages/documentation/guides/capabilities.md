---
group: Guides
title: Capabilities and limits
---

# Capabilities and limits

The packages provide browser-based georeferencing of ordinary
images. They implement the raster-georeferencer workflow, with optional geographic
digitizing. They do not reproduce every format, projection resource or desktop
integration available in a native QGIS/GDAL installation.

## Transformations and coordinates

| Model | Minimum enabled pairs | Mapping |
| --- | --- | --- |
| Linear | 2 with variation in both axes | Translation and independent axis scales |
| Helmert | 2 distinct pairs | Translation, rotation and uniform scale |
| Polynomial 1 | 3 noncollinear pairs | Affine |
| Polynomial 2 | 6 with full rank | Quadratic |
| Polynomial 3 | 10 with full rank | Cubic |
| Projective | 4 in a nondegenerate arrangement | Planar homography |
| Thin plate spline | 3 noncollinear pairs | Smooth interpolation |

Count alone does not establish validity. Rank, conditioning, duplicates, projective
poles and sampled nonlinear domains are checked. Sampled domain checks cannot
prove global invertibility; extreme distortions may be rejected conservatively.

The compatibility baseline is QGIS 3.44.0, GDAL 3.8.4 and PROJ 9.4.0. The product
requires three noncollinear TPS points even though QGIS's low-level transformer
accepts one/two-point special cases. Linear uses QGIS's absolute-scale convention.
Polynomial backward mappings are independently fitted reverse polynomials, not
exact mathematical inverses; TPS uses a Newton inverse and Projective an analytical
inverse. Preview and export use the same fitted model and backward mapping.

Residuals use `r = T(image) - target` and
`RMSE = sqrt(sum(||r||²) / enabledCount)` in the working CRS. Training residuals
are not independent accuracy estimates or a claim to reproduce QGIS's UI RMS.
Image coordinates use original-resolution normalized pixels, top-left corner
origin and downward Y; the first pixel centre is `(0.5, 0.5)`.

## Images, output and resource budgets

- Inputs: ordinary 8-bit nonanimated PNG, grayscale/RGB JPEG, static WebP and
  single-page, orientation-1, chunky uint8 grayscale/RGB/unassociated-RGBA TIFF.
  Supported TIFF compression is none, LZW, Deflate and PackBits. PNG/JPEG/WebP
  normalize all eight EXIF orientations. Unsupported layouts fail explicitly.
- Defaults: 25 MiB compressed input, 24 million input/output pixels, 128 enabled
  GCPs, 768-pixel preview edge and 768 MiB estimated processing reservation.
  Full-resolution buffers still exist. The reservation is not a process-memory
  cap; browsers can require substantially more memory. Deflate reserves extra
  working space and can reduce the output size accepted under the same budget.
- Optional GeoTIFF: uint8 RGBA with alpha or RGB with numeric no-data, strip-based
  none/Deflate/PackBits compression and supported horizontal prediction. Numeric
  no-data cannot preserve partial alpha. COG, scientific/multiband preservation,
  multipage output and arbitrary TIFF creation options are unsupported.
- Resampling: nearest, bilinear, cubic, cubic spline and Lanczos. Source positions
  use 1e-9-pixel precision to stabilize floating-point ties. Files need not be
  byte-identical to GDAL output to have equivalent coordinates and pixels.
- JPEG exports require their world-file/CRS sidecars for placement. Original-pixel
  world-file-only output is limited to Linear/Helmert without reprojection, or
  additionally affine fits with `worldFile({ affine: true })`.
- GeoTIFF output EPSG codes must be below 32767; arbitrary-WKT tagging is not
  supported. Custom working CRSs can be reprojected to a supported output CRS.
- PDF reports support aligned rasters and optional loaded canvas map layers with
  valid CORS. WebGL/custom map renderers need a host adapter. PDF cancellation
  discards the result but cannot interrupt synchronous PDF generation.

## Integration boundaries

The host supplies the map and its library (OpenLayers, MapLibre GL JS or Leaflet
through a map adapter, or a custom adapter), projection definitions and required NTv2
grids, reference authentication and persistence. Adapter capabilities differ: WFS GML
and borrowed host layers need the OpenLayers adapter, and PDF map pages are not
available with Leaflet; see the [map adapters guide](./map-adapters.md). There is no automatic datum-grid download.
Antimeridian/wrapped extents and geometries are rejected; hosts can split reference
queries in a custom loader. Drawing uses Point, LineString and Polygon; existing
holes are preserved, but dedicated hole creation and multipart editing are not
built-in tools. Desktop Chromium, Firefox and WebKit are the automated browser
targets; WebKit testing is not a separate Safari or assistive-technology certification.

See [coordinates and output](./coordinates-and-output.md),
[reference data](./reference-data.md) and [lifecycle and saving](./lifecycle-and-saving.md)
for the integration contracts. Reproducible test fixtures and reference-generation
scripts live in the source repository; local development reports are not shipped
in npm packages or included in this website.
