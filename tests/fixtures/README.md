# Fixture provenance

The grid and orientation imagery in this directory is synthetic and authored for
this package under the repository MIT license. The sourced Spearfish map has separate
provenance and redistribution permission documented below. `python3 tests/fixtures/generators/fixtures.py` recreates the grid, JPEG orientation set and
TIFF inputs; it requires Python 3 standard library and native `gdal_translate`.
The recorded generation environment is GDAL 3.13.3.

- `grid.png`: 100×100 RGBA coordinate ramps, grid lines every ten pixels and a
  red marker at original pixels x=20..29, y=30..39. The browser harness imports this same file; there is no separate demo copy.
- `grid-lzw.tif`: GDAL conversion of the grid with LZW compression.
- `unsupported-16bit.tif`: GDAL UInt16 conversion, intentionally unsupported.
- `quadrants.png` / `quadrants.jpg`: 80×40 RGB, red/green/blue/yellow quadrants
  in top-left/top-right/bottom-left/bottom-right order. JPEG quality 100.
- `exif-1.jpg` through `exif-8.jpg`: identical JPEG image bytes with explicit
  EXIF orientation values 1–8. Browser tests use independent corner-order
  expectations and inspect both previews and Deflate GeoTIFF exports.
- `models.ts`: analytic GCP formulas for numerical and domain tests. These are
  mathematical fixtures, not QGIS reference output.

Pinned QGIS outputs and their complete exact/noisy GCP inputs are stored in
`qgis-transforms.json`; see `tests/reference/qgis-reference.py` and
`tests/reference/qgis-reference.mjs`. They come from the actual pinned QGIS transformer,
not this package's fitter. `qgis-invalid.json` contains independent insufficient,
collinear and conflicting-input cases; regenerate it with
`node tests/reference/qgis-invalid-reference.mjs`. These fixtures retain the pinned QGIS/GDAL/PROJ
versions and container digest. Package comparison measurements remain local reports.
The numerical fixture tests are mandatory and fail if these files are missing.
Native GDAL independently checks exported raster
metadata, landmarks and compression checksums through `tests/reference/engine-check.mjs` and
`tests/reference/native-reference.mjs`.

## Independent QGIS 3.44 raster and interchange fixtures

`qgis-rasters.json` contains 105 actual QGIS-transform/GDAL-kernel output grids.
It includes 70 opaque model/kernel/scale combinations, 20 transparency cases,
10 CRS reprojections, and five real-map reductions. Generation is entirely
independent of package numerical/resampling code (`tests/reference/qgis-raster-reference.py`).
GDAL's `SRC_COORD_PRECISION=1e-9` stabilizes source half-pixel ties; the browser
uses the same declared precision. The two original unrounded Lanczos cases are
retained in `qgis-lanczos-unrounded.json` to document their floating-point sensitivity.

`qgis-3.44.points` was saved by the actual QGIS desktop georeferencer through
Open Raster / Load GCP Points / Save GCP Points actions, including its WKT2 CRS,
17-digit decimal output and disabled fourth point. Regenerate with
`node tests/reference/qgis-points.mjs`. Its residual columns reflect QGIS's active
transformation at save time; import recomputes diagnostics for the selected model.

`constant-shift.gsb` is a synthetic 3×3 NTv2 grid (+1 arcsecond latitude,
+2 arcseconds west longitude), encoded from the NTv2 record format. Native
GDAL/PROJ supplies independent forward coordinates in `datum-grid.json`.
Regenerate with `python3 tests/fixtures/generators/datum-fixture.py`.

## Sourced map

`spearfish-rgba.tif` is a 380×280 nearest-neighbour RGBA reduction of the merged
USGS Spearfish / Deadwood North 1:24,000 digital raster graphics, South Dakota.
Source: https://grass.osgeo.org/sampledata/spearfish_toposheet.tar.gz (GRASS GIS).
The archive's README credits O. Dassau and M. Neteler (September 2004); its
`tcowman.mbox` includes explicit free-redistribution permission from Tim Cowman,
South Dakota Geological Survey, dated 27 September 2004. Original raster:
9500×7000, EPSG:26713, origin (590000,4928000), 2 m pixels. Derived raster:
50 m pixels, unchanged extent [590000,4914000,609000,4928000].

Reproduction (native GDAL 3.13.3):

```sh
curl -L --fail https://grass.osgeo.org/sampledata/spearfish_toposheet.tar.gz -o /tmp/spearfish_toposheet.tar.gz
tar -xzf /tmp/spearfish_toposheet.tar.gz -C /tmp
gdal_translate -outsize 380 280 -r nearest -expand rgba -of GTiff -co COMPRESS=DEFLATE /tmp/spearfish_toposheet/spearfish_topo24.tif tests/fixtures/spearfish-rgba.tif
```

This fixture validates a real raster's established placement; its GCPs come from
that independent geotransform. It is not a claim of a new ground survey.

## WebP orientation input

`quadrants.webp` is a 40×20 four-colour raster generated with Chromium's native
OffscreenCanvas WebP encoder at quality 1: red/green top, blue/yellow bottom.
`tests/browser/formats.spec.ts` injects the eight EXIF orientation tags and checks
the independent expected quadrant order in each browser worker. It is a synthetic
encoding/orientation fixture, not QGIS verification.
