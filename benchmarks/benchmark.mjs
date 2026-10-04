import "../scripts/report-output.mjs";
import { writeFileSync } from "node:fs";
import os from "node:os";
import { chromium } from "@playwright/test";

const harnessURL = process.env.HARNESS_URL ?? "http://127.0.0.1:5174";

const browser = await chromium.launch({ args: ["--js-flags=--expose-gc"] });
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1100 },
  });
  await page.addInitScript(() => {
    const Original = window.Worker;
    window.workerStats = { active: 0, created: 0 };
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args);
        window.workerStats.active++;
        window.workerStats.created++;
        this.done = false;
      }
      terminate() {
        if (!this.done) {
          this.done = true;
          window.workerStats.active--;
        }
        super.terminate();
      }
    };
  });
  await page.goto(`${harnessURL}/validation.html?editors=1`);
  await page.waitForFunction(() => Boolean(window.validation?.editors[0]?.map));
  await page.evaluate(async () => {
    const c = window.validation.editors[0].controller;
    await c.loadImage(
      new File(
        [await (await fetch(window.validation.gridUrl)).blob()],
        "grid.png",
      ),
    );
    c.replaceGcps(window.validation.fixture("polynomial1").slice(0, 4));
  });
  await page.waitForFunction(() =>
    Boolean(window.validation.editors[0].controller.getSnapshot().fit),
  );
  await page.screenshot({
    path: "artifacts/reports/validation.png",
    fullPage: true,
  });
  const result = await page.evaluate(async () => {
    const c = window.validation.editors[0].controller;
    c.setGuard(async () => "discard");
    const waitFit = () =>
      new Promise((resolve, reject) => {
        const check = () => {
          const s = c.getSnapshot();
          if (s.fit) {
            clearInterval(id);
            resolve();
          } else if (s.fitting === "failed") {
            clearInterval(id);
            reject(Error(s.error));
          }
        };
        const id = setInterval(check, 5);
        check();
      });
    const exampleGcps = structuredClone(c.getSnapshot().document.gcps),
      blob = await (await fetch(window.validation.gridUrl)).blob(),
      file = new File([blob], "grid.png", { type: "image/png" });
    const heap = [],
      previewMs = [];
    for (let i = 0; i < 20; i++) {
      await c.loadImage(file);
      const start = performance.now();
      c.replaceGcps(exampleGcps);
      await waitFit();
      previewMs.push(performance.now() - start);
      await c.removeImage();
      window.gc?.();
      heap.push(performance.memory?.usedJSHeapSize ?? null);
    }
    const canvas = document.createElement("canvas");
    canvas.width = 6000;
    canvas.height = 4000;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#a87";
    ctx.fillRect(0, 0, 6000, 4000);
    ctx.fillStyle = "#f33";
    ctx.fillRect(2000, 1000, 1000, 1000);
    const source = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    canvas.width = 0;
    const large = new File([source], "24mp.png", { type: "image/png" });
    const loadStart = performance.now();
    const loaded = await c.loadImage(large);
    const inspectMs = performance.now() - loadStart;
    const gcps = exampleGcps.map((p) => ({
      ...p,
      image: [p.image[0] * 60, p.image[1] * 40],
      target: [1000 + p.image[0] * 60, 5000 - p.image[1] * 40],
    }));
    gcps.push(
      ...[
        [3000, 2000],
        [1000, 1000],
        [5000, 3000],
        [4000, 1000],
        [1000, 3000],
        [5000, 1000],
      ].map((image, i) => ({
        id: `dense-${i}`,
        label: i + 5,
        enabled: true,
        image,
        target: [1000 + image[0], 5000 - image[1]],
        crs: "EPSG:3857",
      })),
    );
    const fitStart = performance.now();
    c.replaceGcps(gcps);
    await waitFit();
    const largePreviewMs = performance.now() - fitStart;
    c.setOutput({
      crs: "EPSG:3857",
      resampler: "bilinear",
      resolution: [1, 1],
    });
    let ticks = 0;
    const timer = setInterval(() => ticks++, 10);
    const exportStart = performance.now();
    const output = await c.exportRaster();
    const exportMs = performance.now() - exportStart;
    clearInterval(timer);
    const cancelStart = performance.now();
    const cancelled = c.exportRaster();
    c.cancelExport();
    await cancelled;
    const cancelMs = performance.now() - cancelStart;
    // Header dimensions are inspected before decoder/CRC work, so no 100MP allocation.
    const bytes = new Uint8Array(await source.arrayBuffer()),
      view = new DataView(bytes.buffer);
    view.setUint32(16, 10000);
    view.setUint32(20, 10000);
    const rejected = !(await c.loadImage(new File([bytes], "100mp.png")));
    const rejectedMessage = c.getSnapshot().error;
    await c.removeImage();
    window.gc?.();
    return {
      cycles: 20,
      previewMs,
      p95: previewMs.toSorted((a, b) => a - b)[18],
      heap,
      workerStats: window.workerStats,
      large: {
        loaded,
        inputBytes: source.size,
        inspectMs,
        previewMs: largePreviewMs,
        exportMs,
        width: output?.raster.width,
        height: output?.raster.height,
        exportBytes: output?.blob.size,
        estimatedBytes: output?.raster.estimatedBytes,
        eventLoopTicks: ticks,
      },
      cancelMs,
      rejected100mp: rejected,
      rejectedMessage,
    };
  });
  writeFileSync(
    "artifacts/reports/benchmark.json",
    `${JSON.stringify(
      {
        browser: browser.version(),
        platform: os.platform(),
        arch: os.arch(),
        cpu: os.cpus()[0].model,
        node: process.version,
        ...result,
      },
      null,
      2,
    )}\n`,
  );
  console.log({
    p95: result.p95,
    large: result.large,
    cancelMs: result.cancelMs,
    workers: result.workerStats,
    rejected100mp: result.rejected100mp,
  });
} finally {
  await browser.close();
}
