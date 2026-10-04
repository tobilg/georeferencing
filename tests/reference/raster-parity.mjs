import "../../scripts/report-output.mjs";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { fitTransform, project } from "@georeferencing/core";
import { warp } from "@georeferencing/core/engine";
import { fromArrayBuffer } from "geotiff";

const modelFixtures = JSON.parse(
  readFileSync("tests/fixtures/qgis-transforms.json"),
).records.filter((f) => f.case === "exact");
const definitions = {
  "EPSG:26713": "+proj=utm +zone=13 +datum=NAD27 +units=m +no_defs +type=crs",
  "EPSG:25832": "+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs +type=crs",
};
const source = new Uint8ClampedArray(100 * 100 * 4);
for (let y = 0; y < 100; y++)
  for (let x = 0; x < 100; x++)
    source.set(
      [
        (x * 13 + y * 7) % 256,
        (x * 3 + y * 19) % 256,
        ((x >> 2) + (y >> 2)) % 2 ? 230 : 20,
        255,
      ],
      (y * 100 + x) * 4,
    );
const translucent = source.slice();
for (let y = 0; y < 100; y++)
  for (let x = 0; x < 100; x++)
    translucent[(y * 100 + x) * 4 + 3] =
      x < 15 || Math.hypot(x - 50, y - 50) < 12 ? 0 : x > 65 ? 128 : 255;
let evidence;
if (process.argv.includes("--generate")) {
  const fixtures = [];
  const add = (f, scale, resampler, variant = "opaque") =>
    fixtures.push({
      model: f.model,
      gcps: f.gcps,
      resampler,
      scale,
      variant,
      sourceWidth: 100,
      sourceHeight: 100,
      source: Buffer.from(variant === "alpha" ? translucent : source).toString(
        "base64",
      ),
      alpha: variant === "alpha",
      width: scale === "up" ? 224 : 56,
      height: scale === "up" ? 288 : 72,
      bounds: [980, 1680, 1260, 2040],
      workingCrs: "EPSG:3857",
      crs: "EPSG:3857",
      warpOptions: { SRC_COORD_PRECISION: 1e-9 },
    });
  for (const f of modelFixtures)
    for (const scale of ["up", "down"])
      for (const method of [
        "nearest",
        "bilinear",
        "cubic",
        "cubicSpline",
        "lanczos",
      ])
        add(f, scale, method);
  for (const f of modelFixtures.filter((f) =>
    ["helmert", "thinPlateSpline"].includes(f.model),
  ))
    for (const scale of ["up", "down"])
      for (const method of [
        "nearest",
        "bilinear",
        "cubic",
        "cubicSpline",
        "lanczos",
      ])
        add(f, scale, method, "alpha");
  for (const crs of ["EPSG:4326", "EPSG:25832"])
    for (const method of [
      "nearest",
      "bilinear",
      "cubic",
      "cubicSpline",
      "lanczos",
    ]) {
      add(
        modelFixtures.find((f) => f.model === "polynomial2"),
        "up",
        method,
        "reprojection",
      );
      const f = fixtures.at(-1);
      f.bounds = [
        ...project(f.bounds.slice(0, 2), "EPSG:3857", crs, definitions),
        ...project(f.bounds.slice(2), "EPSG:3857", crs, definitions),
      ];
      f.crs = crs;
    }
  const bytes = readFileSync("tests/fixtures/spearfish-rgba.tif");
  const tiff = await fromArrayBuffer(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ),
    image = await tiff.getImage();
  const rgba = await image.readRasters({ interleave: true });
  const gcps = [
    [0, 0],
    [380, 0],
    [0, 280],
    [380, 280],
    [190, 140],
  ].map(([x, y], i) => ({
    id: `real-${i}`,
    label: i + 1,
    enabled: true,
    image: [x, y],
    target: [590000 + x * 50, 4928000 - y * 50],
    crs: "EPSG:26713",
  }));
  for (const resampler of [
    "nearest",
    "bilinear",
    "cubic",
    "cubicSpline",
    "lanczos",
  ])
    fixtures.push({
      model: "polynomial1",
      gcps,
      resampler,
      scale: "down",
      variant: "spearfish",
      sourceWidth: 380,
      sourceHeight: 280,
      source: Buffer.from(rgba).toString("base64"),
      alpha: true,
      width: 152,
      height: 112,
      bounds: [590000, 4914000, 609000, 4928000],
      workingCrs: "EPSG:26713",
      crs: "EPSG:26713",
      warpOptions: { SRC_COORD_PRECISION: 1e-9 },
    });
  evidence = JSON.parse(
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "-i",
        "--platform",
        "linux/amd64",
        "--network",
        "none",
        "--read-only",
        "--tmpfs",
        "/tmp",
        "-e",
        "QT_QPA_PLATFORM=offscreen",
        "-v",
        `${resolve("tests/reference/qgis-raster-reference.py")}:/work/reference.py:ro`,
        "qgis/qgis@sha256:d573fb911eebe29fcf81419868f5d41e8ff7b384d9775cca819cdef2c3989ce6",
        "python3",
        "/work/reference.py",
      ],
      {
        input: JSON.stringify(
          process.env.RASTER_CASES
            ? fixtures.slice(0, Number(process.env.RASTER_CASES))
            : fixtures,
        ),
        stdio: ["pipe", "pipe", "inherit"],
        encoding: "utf8",
        maxBuffer: 40 * 1024 * 1024,
      },
    ),
  );
  evidence.sources = {
    opaque: Buffer.from(source).toString("base64"),
    alpha: Buffer.from(translucent).toString("base64"),
    reprojection: Buffer.from(source).toString("base64"),
    spearfish: Buffer.from(rgba).toString("base64"),
  };
  evidence.definitions = definitions;
  writeFileSync(
    "tests/fixtures/qgis-rasters.json",
    `${JSON.stringify(evidence)}\n`,
  );
} else evidence = JSON.parse(readFileSync("tests/fixtures/qgis-rasters.json"));
const summary = [];
for (const f of evidence.records) {
  const fit = fitTransform(f.gcps, f.model),
    expected = inflateSync(Buffer.from(f.rgbaZlib, "base64"));
  const input = {
    data: new Uint8ClampedArray(
      Buffer.from(evidence.sources[f.variant], "base64"),
    ),
    width: f.sourceWidth,
    height: f.sourceHeight,
  };
  const result = warp(
    input,
    input,
    fit,
    f.workingCrs,
    {
      width: f.width,
      height: f.height,
      bounds: f.bounds,
      crs: f.crs,
      estimatedBytes: 0,
    },
    f.resampler,
    definitions,
  );
  let max = 0,
    sum = 0,
    n = 0,
    alphaMismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    const d = Math.abs(expected[i] - result.data[i]);
    max = Math.max(max, d);
    sum += d;
    n += d > 1 ? 1 : 0;
    if (i % 4 === 3 && d > 1) alphaMismatch++;
  }
  summary.push({
    model: f.model,
    resampler: f.resampler,
    scale: f.scale,
    variant: f.variant,
    crs: f.crs,
    max,
    mae: sum / expected.length,
    mismatch: n,
    alphaMismatch,
  });
}
writeFileSync(
  "artifacts/reports/raster-parity.json",
  `${JSON.stringify(
    {
      qgis: evidence.qgis,
      gdal: evidence.gdal,
      comparison:
        "same output grid; all pixels; actual QGIS transform, GDAL raster kernel; GDAL SRC_COORD_PRECISION=1e-9 pixels to stabilize exact half-pixel ties",
      records: summary,
    },
    null,
    2,
  )}\n`,
);
console.log({
  cases: summary.length,
  withinOneByte: summary.filter((r) => r.max <= 1).length,
  failures: summary.filter((r) => r.max > 1),
});
