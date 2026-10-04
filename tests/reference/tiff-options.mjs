import "../../scripts/report-output.mjs";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { encodeGeoTiffBlob } from "@georeferencing/plugins/tiff";

mkdirSync("artifacts", { recursive: true });
const data = new Uint8ClampedArray(19 * 17 * 4),
  records = [];
for (let y = 0; y < 17; y++)
  for (let x = 0; x < 19; x++)
    data.set(
      [(x * 11) % 253, (y * 7) % 253, 181, x === 1 && y === 1 ? 0 : 255],
      (y * 19 + x) * 4,
    );
for (const compression of ["none", "deflate", "packbits"])
  for (const noData of [undefined, 254]) {
    const options = {
      compression,
      noData,
      rowsPerStrip: 3,
      predictor: compression === "deflate" ? 2 : 1,
    };
    const blob = await encodeGeoTiffBlob(
        data,
        19,
        17,
        [500000, 5299949, 500038, 5300000],
        "EPSG:25832",
        false,
        options,
      ),
      path = `artifacts/strips-${compression}-${noData === undefined ? "alpha" : "nodata"}.tif`;
    writeFileSync(path, new Uint8Array(await blob.arrayBuffer()));
    const info = JSON.parse(
      execFileSync("gdalinfo", ["-json", "-checksum", path], {
        encoding: "utf8",
      }),
    );
    const pixel = (x, y) =>
      execFileSync(
        "gdallocationinfo",
        ["-valonly", path, String(x), String(y)],
        { encoding: "utf8" },
      )
        .trim()
        .split("\n")
        .map(Number);
    const colored = pixel(3, 4),
      empty = pixel(1, 1),
      expected = noData === undefined ? [33, 28, 181, 255] : [33, 28, 181];
    if (JSON.stringify(colored) !== JSON.stringify(expected))
      throw Error(`Color mismatch ${path}`);
    if (
      noData !== undefined &&
      (!empty.every((v) => v === 254) ||
        info.bands.some((b) => b.noDataValue !== 254))
    )
      throw Error(`No-data mismatch ${path}`);
    if (noData === undefined && empty[3] !== 0)
      throw Error(`Alpha mismatch ${path}`);
    if (info.geoTransform.join(",") !== "500000,2,0,5300000,0,-3")
      throw Error(`Placement mismatch ${path}`);
    if (!info.coordinateSystem.wkt.includes("25832"))
      throw Error(`CRS mismatch ${path}`);
    records.push({
      path,
      options,
      bytes: blob.size,
      geoTransform: info.geoTransform,
      checksums: info.bands.map((b) => b.checksum),
      color: colored,
      empty,
    });
  }
writeFileSync(
  "artifacts/reports/tiff-options.json",
  `${JSON.stringify(
    {
      gdal: execFileSync("gdalinfo", ["--version"], {
        encoding: "utf8",
      }).trim(),
      records,
    },
    null,
    2,
  )}\n`,
);
console.log({
  independentTiffChecks: records.length,
  compressions: 3,
  rowsPerStrip: 3,
});
