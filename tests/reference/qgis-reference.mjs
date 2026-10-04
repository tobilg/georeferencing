import "../../scripts/report-output.mjs";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  backward,
  fitTransform,
  forward,
  validateDomain,
} from "@georeferencing/core";

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
  linear: ([x, y]) => [1000 + 2 * x, 2000 - 3 * y],
  helmert: ([x, y]) => [1000 + 2 * x + 0.5 * y, 2000 + 0.5 * x - 2 * y],
  polynomial1: ([x, y]) => [1000 + 2 * x + 0.3 * y, 2000 + 0.2 * x - 3 * y],
  polynomial2: ([x, y]) => [
    1000 + 2 * x + 0.002 * x * y,
    2000 - 3 * y + 0.001 * x * x,
  ],
  polynomial3: ([x, y]) => [
    1000 + 2 * x + 0.000002 * x * x * y,
    2000 - 3 * y + 0.000001 * x * y * y,
  ],
  projective: ([x, y]) => [
    (1000 + 2 * x + 0.3 * y) / (1 + 0.0001 * x + 0.0002 * y),
    (2000 + 0.2 * x - 3 * y) / (1 + 0.0001 * x + 0.0002 * y),
  ],
  thinPlateSpline: ([x, y]) => [
    1000 + 2 * x + 0.002 * x * y,
    2000 - 3 * y + 0.001 * x * x,
  ],
};
const fixtures = [];
for (const [model, fn] of Object.entries(functions))
  for (const noise of [false, true])
    fixtures.push({
      model,
      case: noise ? "noisy" : "exact",
      gcps: grid.map((image, i) => ({
        id: String(i),
        label: i + 1,
        enabled: true,
        image,
        target: fn(image).map(
          (v, j) => v + (noise ? Math.sin(i * 3 + j) * 0.1 : 0),
        ),
        crs: "EPSG:3857",
      })),
      checkpoints: [
        [20, 30],
        [80, 70],
        [50, 50],
      ],
    });
for (const count of [1, 2, 3])
  fixtures.push({
    model: "thinPlateSpline",
    case: `minimum-${count}`,
    gcps: [
      [0, 0],
      [100, 0],
      [0, 100],
    ]
      .slice(0, count)
      .map((image, i) => ({
        id: String(i),
        label: i + 1,
        enabled: true,
        image,
        target: functions.polynomial1(image),
        crs: "EPSG:3857",
      })),
    checkpoints: [[20, 30]],
  });
const args = [
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
  `${resolve("tests/reference/qgis-reference.py")}:/work/reference.py:ro`,
  "qgis/qgis@sha256:d573fb911eebe29fcf81419868f5d41e8ff7b384d9775cca819cdef2c3989ce6",
  "python3",
  "/work/reference.py",
];
const result = JSON.parse(
  execFileSync("docker", args, {
    input: JSON.stringify(fixtures),
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  }),
);
// Save independent QGIS results before adding package comparison measurements.
writeFileSync(
  "tests/fixtures/qgis-transforms.json",
  `${JSON.stringify(result, null, 2)}\n`,
);
for (const record of result.records) {
  try {
    const fit = fitTransform(record.gcps, record.model);
    validateDomain(fit, 100, 100);
    record.packageValid = true;
    record.forwardErrors = record.checkpoints.map((p, i) =>
      Math.hypot(
        ...forward(fit, p).map((v, j) => v - record.qgisForward[i][j + 1]),
      ),
    );
    record.backwardDifferences = record.qgisForward.map((q, i) =>
      Math.hypot(
        ...backward(fit, q.slice(1)).map(
          (v, j) => v - record.qgisBackward[i][j + 1],
        ),
      ),
    );
  } catch (e) {
    record.packageValid = false;
    record.packageError = e.message;
  }
}
writeFileSync(
  "artifacts/reports/qgis-3.44.0.json",
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log({
  qgis: result.qgis,
  gdal: result.gdal,
  proj: result.proj,
  records: result.records.map((r) => ({
    model: r.model,
    case: r.case,
    forward: r.forwardErrors && Math.max(...r.forwardErrors),
    backward: r.backwardDifferences && Math.max(...r.backwardDifferences),
    valid: r.valid,
    packageValid: r.packageValid,
  })),
});
