import "../../scripts/report-output.mjs";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const records = [];
for (const browser of ["chromium", "firefox", "webkit"]) {
  const path = `artifacts/world-file-${browser}.png`,
    info = JSON.parse(
      execFileSync("gdalinfo", ["-json", path], { encoding: "utf8" }),
    );
  const color = execFileSync("gdallocationinfo", ["-valonly", path, "5", "5"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .map(Number);
  if (
    info.geoTransform.some(
      (v, i) => Math.abs(v - [1000, 2, 0, 2000, 0, -3][i]) > 1e-8,
    ) ||
    info.size.join() !== "40,80" ||
    color.slice(0, 3).join() !== "0,0,255"
  )
    throw Error(`World file mismatch ${browser}`);
  records.push({
    browser,
    geoTransform: info.geoTransform,
    size: info.size,
    color,
    crs: "EPSG:3857 (explicit .crs.json; world files contain no CRS)",
  });
}
writeFileSync(
  "artifacts/reports/world-file.json",
  `${JSON.stringify(
    {
      reader: execFileSync("gdalinfo", ["--version"], {
        encoding: "utf8",
      }).trim(),
      records,
    },
    null,
    2,
  )}\n`,
);
console.log({ worldFileChecks: records.length });
