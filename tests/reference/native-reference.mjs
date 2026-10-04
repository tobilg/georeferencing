import "../../scripts/report-output.mjs";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { backward, fitTransform, forward } from "@georeferencing/core";

const version = execFileSync("gdalinfo", ["--version"], {
  encoding: "utf8",
}).trim();
const grid = [
  [0, 0],
  [100, 0],
  [0, 100],
  [100, 100],
  [50, 0],
  [0, 50],
  [50, 100],
  [100, 50],
  [25, 25],
  [75, 25],
  [25, 75],
  [75, 75],
  [50, 50],
  [10, 30],
  [90, 70],
  [20, 80],
];
const functions = {
  polynomial1: ([x, y]) => [1000 + 2 * x + 0.3 * y, 2000 + 0.2 * x - 3 * y],
  polynomial2: ([x, y]) => [
    1000 + 2 * x + 0.002 * x * y,
    2000 - 3 * y + 0.001 * x * x,
  ],
  polynomial3: ([x, y]) => [
    1000 + 2 * x + 0.000002 * x * x * y,
    2000 - 3 * y + 0.000001 * x * y * y,
  ],
  thinPlateSpline: ([x, y]) => [
    1000 + 2 * x + 0.002 * x * y,
    2000 - 3 * y + 0.001 * x * x,
  ],
};
const checkpoints = [
    [20, 30],
    [80, 70],
    [50, 50],
  ],
  records = [];
for (const [model, fn] of Object.entries(functions)) {
  const gcps = grid.map((image, i) => ({
    id: String(i),
    label: i + 1,
    enabled: true,
    image,
    target: fn(image),
    crs: "EPSG:3857",
  }));
  const args = [
    ...(model === "thinPlateSpline" ? ["-tps"] : ["-order", model.slice(-1)]),
    ...gcps.flatMap((p) => [
      "-gcp",
      ...p.image.map(String),
      ...p.target.map(String),
    ]),
  ];
  const run = (args, points) =>
    execFileSync("gdaltransform", args, {
      input: `${points.map((p) => p.join(" ")).join("\n")}\n`,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .map((l) => l.trim().split(/\s+/).slice(0, 2).map(Number));
  const expected = run(args, checkpoints),
    inverse = run(["-i", ...args], expected),
    fit = fitTransform(gcps, model);
  const forwardErrors = checkpoints.map((p, i) =>
      Math.hypot(...forward(fit, p).map((v, j) => v - expected[i][j])),
    ),
    backwardDifference = inverse.map((q, i) =>
      Math.hypot(...backward(fit, expected[i]).map((v, j) => v - q[j])),
    );
  if (Math.max(...forwardErrors) > 1e-6)
    throw Error(`Forward mismatch: ${model}`);
  records.push({
    model,
    gcps,
    checkpoints,
    expected,
    inverse,
    forwardErrors,
    backwardDifference,
    args,
  });
}
const tpsMinimum = [];
for (const source of [
  [[0, 0]],
  [
    [0, 0],
    [100, 0],
  ],
  [
    [0, 0],
    [50, 0],
    [100, 0],
  ],
  [
    [0, 0],
    [100, 0],
    [0, 100],
  ],
]) {
  const args = [
    "-tps",
    ...source.flatMap(([x, y]) => [
      "-gcp",
      String(x),
      String(y),
      String(1000 + 2 * x),
      String(2000 - 3 * y),
    ]),
  ];
  try {
    tpsMinimum.push({
      count: source.length,
      source,
      result: execFileSync("gdaltransform", args, {
        input: "20 30\n",
        encoding: "utf8",
      }).trim(),
    });
  } catch (e) {
    tpsMinimum.push({ count: source.length, source, error: String(e.stderr) });
  }
}
const rasterChecks = [];
for (const model of ["polynomial1", "polynomial2", "thinPlateSpline"]) {
  const path = `artifacts/${model}.tif`;
  const info = JSON.parse(
    execFileSync("gdalinfo", ["-json", path], { encoding: "utf8" }),
  );
  // Marker occupies source [20,30] x [30,40]; test a known interior pixel using native GDAL.
  const [x, y] = functions[model]([25.5, 35.5]);
  const rgba = execFileSync(
    "gdallocationinfo",
    ["-valonly", "-geoloc", path, String(x), String(y)],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .map(Number);
  if (rgba[0] !== 255 || rgba[1] !== 40 || rgba[2] !== 20 || rgba[3] !== 255)
    throw Error(`Raster landmark mismatch ${model} ${rgba}`);
  rasterChecks.push({
    model,
    coordinate: [x, y],
    rgba,
    geoTransform: info.geoTransform,
  });
}
writeFileSync(
  "artifacts/reports/native-gdal.json",
  `${JSON.stringify(
    {
      version,
      baseline: "Independent native GDAL, NOT pinned QGIS parity",
      records,
      tpsMinimum,
      rasterChecks,
    },
    null,
    2,
  )}\n`,
);
console.log({
  version,
  models: records.length,
  maxForwardError: Math.max(...records.flatMap((r) => r.forwardErrors)),
  rasterLandmarks: rasterChecks.length,
});
