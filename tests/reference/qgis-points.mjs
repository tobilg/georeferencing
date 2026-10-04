import "../../scripts/report-output.mjs";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const output = execFileSync(
  "docker",
  [
    "run",
    "--rm",
    "--platform",
    "linux/amd64",
    "--network",
    "none",
    "--read-only",
    "--tmpfs",
    "/tmp",
    "-e",
    "DISPLAY=:99",
    "-e",
    "QT_QPA_PLATFORM=offscreen",
    "-v",
    `${resolve("tests/reference/qgis-points-reference.py")}:/work/reference.py:ro`,
    "-v",
    `${resolve("tests/fixtures")}:/fixtures:ro`,
    "qgis/qgis@sha256:d573fb911eebe29fcf81419868f5d41e8ff7b384d9775cca819cdef2c3989ce6",
    "qgis",
    "--nologo",
    "--noversioncheck",
    "--profiles-path",
    "/tmp/profiles",
    "--authdbdirectory",
    "/tmp/auth",
    "--code",
    "/work/reference.py",
  ],
  { encoding: "utf8", timeout: 70000 },
);
const line = output.split("\n").find((s) => s.startsWith("QGIS_POINTS="));
if (!line) throw Error(output);
const evidence = JSON.parse(line.slice(12));
writeFileSync(
  "tests/fixtures/qgis-3.44.points",
  Buffer.from(evidence.fixtureBase64, "base64"),
);
writeFileSync(
  "artifacts/reports/qgis-points.json",
  `${JSON.stringify(evidence, null, 2)}\n`,
);
console.log({ qgis: evidence.qgis, method: evidence.method });
