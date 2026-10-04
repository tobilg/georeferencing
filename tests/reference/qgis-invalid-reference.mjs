import "../../scripts/report-output.mjs";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fitTransform, MODELS, validateDomain } from "@georeferencing/core";

const exact = JSON.parse(
  readFileSync("tests/fixtures/qgis-transforms.json"),
).records.filter((r) => r.case === "exact");
const fixtures = [];
for (const f of exact) {
  fixtures.push({
    ...f,
    case: "insufficient",
    gcps: f.gcps.slice(0, MODELS[f.model].minimum - 1),
  });
  fixtures.push({
    ...f,
    case: "collinear",
    gcps: f.gcps.map((p, i) => ({
      ...p,
      image: [i * 5, 0],
      target: [1000 + i * 10, 2000],
    })),
  });
  fixtures.push({
    ...f,
    case: "duplicate-conflict",
    gcps: [
      ...f.gcps,
      { ...f.gcps[0], id: "conflict", label: 17, target: [1100, 2100] },
    ],
  });
}
const result = JSON.parse(
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
      `${resolve("tests/reference/qgis-reference.py")}:/work/reference.py:ro`,
      "qgis/qgis@sha256:d573fb911eebe29fcf81419868f5d41e8ff7b384d9775cca819cdef2c3989ce6",
      "python3",
      "/work/reference.py",
    ],
    {
      input: JSON.stringify(fixtures),
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    },
  ),
);
// Save independent QGIS results before adding package comparison measurements.
writeFileSync(
  "tests/fixtures/qgis-invalid.json",
  `${JSON.stringify(result, null, 2)}\n`,
);
for (const r of result.records) {
  try {
    validateDomain(fitTransform(r.gcps, r.model), 100, 100);
    r.packageValid = true;
  } catch (e) {
    r.packageValid = false;
    r.packageError = { code: e.code, message: e.message };
  }
}
writeFileSync(
  "artifacts/reports/qgis-invalid.json",
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(
  result.records.map(({ model, case: name, valid, packageValid }) => ({
    model,
    case: name,
    qgisValid: valid,
    packageValid,
  })),
);
