# Independent reference checks

Run these commands from the workspace root after `pnpm build:packages`. They
compare processing against native GDAL or pinned QGIS 3.44. Committed expected
values remain in `tests/fixtures`; measurements go to ignored `artifacts/reports/`.
Normal unit/browser regression tests do not require native GIS tools or Docker.

| Command | Inputs and prerequisites |
| --- | --- |
| `node tests/reference/engine-check.mjs` | Start `pnpm dev:harness` separately; uses Chromium and native `gdalinfo` to read actual browser exports |
| `node tests/reference/native-reference.mjs` | Native GDAL; consumes rasters written by the engine check |
| `node tests/reference/tiff-options.mjs` | Native GDAL; checks compression, strip layout and no-data output |
| `node tests/reference/world-file-reference.mjs` | Native GDAL; consumes original-pixel exports written by browser tests |
| `node tests/reference/raster-parity.mjs` | Reads the committed QGIS raster fixture and records package comparison results |

`engine-check.mjs` defaults to `http://127.0.0.1:5174`; set `HARNESS_URL` for a
different harness server. It performs local image processing, not image uploads.

## Regenerating reference fixtures

The following commands deliberately replace committed expected values. Use the
pinned QGIS container encoded in the scripts, then review fixture changes:

```sh
node tests/reference/qgis-reference.mjs
node tests/reference/qgis-invalid-reference.mjs
node tests/reference/qgis-points.mjs
node tests/reference/raster-parity.mjs --generate
```

The adjacent Python files execute inside that container. Node scripts retain
independent QGIS results separately from package-specific measurements. Synthetic
source-image and datum-grid generators live in `tests/fixtures/generators/`;
see [fixture provenance](../fixtures/README.md) for versions and prerequisites.
Rerunning package comparisons alone does not regenerate independent QGIS evidence.
