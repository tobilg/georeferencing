import "../../scripts/report-output.mjs";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const harnessURL = process.env.HARNESS_URL ?? "http://127.0.0.1:5174";

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error(e));
  await page.goto(`${harnessURL}/engine.html`);
  await page.waitForFunction(() => typeof window.runEngine === "function");
  // Real File created by browser file selection, never uploaded.
  await page.locator("input").setInputFiles("tests/fixtures/grid.png");
  await page.waitForFunction(() =>
    document.querySelector("pre").textContent.includes("dimensions"),
  );
  mkdirSync("artifacts", { recursive: true });
  const records = [];
  for (const [model, compression] of [
    ["polynomial1", "none"],
    ["polynomial2", "none"],
    ["thinPlateSpline", "none"],
    ["polynomial1", "deflate"],
  ]) {
    const record = await page.evaluate(
      async ({ model, compression }) => {
        const file = document.querySelector("input").files[0];
        const value = await window.runEngine(file, model, compression);
        const a = value.preview.raster,
          b = value.result.raster;
        return {
          model,
          compression,
          width: b.width,
          height: b.height,
          bounds: b.bounds,
          rmse: value.fit.rmse,
          exportMs: value.result.elapsedMs,
          estimatedBytes: b.estimatedBytes,
          samePixels: a.data.every((x, i) => x === b.data[i]),
          tiff: Array.from(
            new Uint8Array(await value.result.blob.arrayBuffer()),
          ),
        };
      },
      { model, compression },
    );
    const filename = `artifacts/${model}${compression === "none" ? "" : `-${compression}`}.tif`;
    writeFileSync(filename, new Uint8Array(record.tiff));
    delete record.tiff;
    const gdal = JSON.parse(
      execFileSync("gdalinfo", ["-json", "-checksum", filename], {
        encoding: "utf8",
      }),
    );
    if (!gdal.coordinateSystem.wkt.includes("3857") || !record.samePixels)
      throw new Error("Independent CRS or preview/export check failed");
    record.gdal = {
      size: gdal.size,
      geoTransform: gdal.geoTransform,
      crs: gdal.coordinateSystem.wkt.split("\n")[0],
      compression: gdal.metadata.IMAGE_STRUCTURE.COMPRESSION ?? "NONE",
      checksums: gdal.bands.map((b) => b.checksum),
    };
    if (
      compression === "deflate" &&
      (record.gdal.compression !== "DEFLATE" ||
        JSON.stringify(record.gdal.checksums) !==
          JSON.stringify(records[0].gdal.checksums))
    )
      throw Error("Deflate metadata or independent pixel checksum mismatch");
    records.push(record);
  }
  writeFileSync(
    "artifacts/reports/engine.json",
    `${JSON.stringify(
      {
        browser: browser.version(),
        gdal: execFileSync("gdalinfo", ["--version"], {
          encoding: "utf8",
        }).trim(),
        records,
      },
      null,
      2,
    )}\n`,
  );
  console.log(records);
} finally {
  await browser.close();
}
