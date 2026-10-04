import "../scripts/report-output.mjs";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname } from "node:path";
import { chromium, firefox, webkit } from "@playwright/test";

const harnessURL = process.env.HARNESS_URL ?? "http://127.0.0.1:5174";

const selected = process.argv
  .find((a) => a.startsWith("--browser="))
  ?.split("=")[1];
const results =
  selected && existsSync("artifacts/reports/benchmark-all.json")
    ? JSON.parse(
        readFileSync("artifacts/reports/benchmark-all.json"),
      ).results.filter((r) => r.browser !== selected)
    : [];
for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
  if (selected && name !== selected) continue;
  const priorPids = new Set(
    execFileSync("ps", ["-axo", "pid="], { encoding: "utf8" })
      .trim()
      .split(/\s+/)
      .map(Number),
  );
  const distributionRoot = dirname(type.executablePath());
  const server = await type.launchServer(
    name === "chromium" ? { args: ["--js-flags=--expose-gc"] } : {},
  );
  const browser = await type.connect(server.wsEndpoint());
  const pid = server.process().pid;
  const samples = [];
  let sampling = false;
  const sample = () => {
    if (sampling) return;
    sampling = true;
    try {
      const rows = execFileSync("ps", ["-axo", "pid=,ppid=,rss=,command="], {
        encoding: "utf8",
      })
        .trim()
        .split("\n")
        .map((s) => {
          const m = s.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
          return [Number(m[1]), Number(m[2]), Number(m[3]), m[4]];
        });
      const pids = new Set([pid]);
      // WebKit XPC services are parented by launchd (PID 1), not MiniBrowser.
      for (const [p, , , command] of rows)
        if (!priorPids.has(p) && command.includes(distributionRoot))
          pids.add(p);
      let grew = true;
      while (grew) {
        grew = false;
        for (const [p, parent] of rows)
          if (pids.has(parent) && !pids.has(p)) {
            pids.add(p);
            grew = true;
          }
      }
      samples.push({
        at: Date.now(),
        rssBytes: rows
          .filter(([p]) => pids.has(p))
          .reduce((sum, r) => sum + r[2] * 1024, 0),
        processes: pids.size,
      });
    } finally {
      sampling = false;
    }
  };
  const timer = setInterval(sample, 100);
  try {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1100 },
    });
    await page.addInitScript(() => {
      const create = URL.createObjectURL.bind(URL),
        revoke = URL.revokeObjectURL.bind(URL),
        urls = new Set();
      window.urlStats = { active: 0, created: 0, revoked: 0 };
      URL.createObjectURL = (blob) => {
        const url = create(blob);
        urls.add(url);
        window.urlStats.active = urls.size;
        window.urlStats.created++;
        return url;
      };
      URL.revokeObjectURL = (url) => {
        if (urls.delete(url)) window.urlStats.revoked++;
        window.urlStats.active = urls.size;
        revoke(url);
      };
      const Original = window.Worker;
      window.workerStats = { active: 0, created: 0 };
      window.Worker = class extends Original {
        constructor(...args) {
          super(...args);
          window.workerStats.active++;
          window.workerStats.created++;
          this.finished = false;
        }
        terminate() {
          if (!this.finished) {
            this.finished = true;
            window.workerStats.active--;
          }
          super.terminate();
        }
      };
    });
    const navigation = Date.now();
    await page.goto(`${harnessURL}/validation.html`);
    await page.waitForFunction(
      () => window.validation?.editors.filter(Boolean).length === 2,
    );
    await page.locator(".rg-editor").nth(1).waitFor();
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const assetReadyMs = Date.now() - navigation;
    const result = await page.evaluate(async () => {
      const v = window.validation,
        c = v.editors[0].controller;
      const waitFit = () =>
        new Promise((resolve, reject) => {
          const timer = setInterval(() => {
            const s = c.getSnapshot();
            if (s.fit) {
              clearInterval(timer);
              resolve();
            } else if (s.fitting === "failed") {
              clearInterval(timer);
              reject(Error(s.error));
            }
          }, 5);
        });
      const load = async (file, stage) => {
        if (!(await c.loadImage(file)))
          throw Error(`${stage}: ${c.getSnapshot().error}`);
      };
      const file = new File(
          [await (await fetch(window.validation.gridUrl)).blob()],
          "grid.png",
        ),
        gcps = v.fixture("polynomial1");
      const coldStart = performance.now();
      await load(file, "100px fixture");
      c.replaceGcps(gcps);
      await waitFit();
      const coldImageToPreviewMs = performance.now() - coldStart;
      const previewMs = [],
        heap = [],
        resourceCycles = [];
      for (let i = 0; i < 20; i++) {
        await load(file, "100px fixture");
        const t = performance.now();
        c.replaceGcps(gcps);
        await waitFit();
        previewMs.push(performance.now() - t);
        await c.removeImage();
        window.gc?.();
        heap.push(performance.memory?.usedJSHeapSize ?? null);
        resourceCycles.push({
          workers: window.workerStats.active,
          urls: window.urlStats.active,
        });
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
      canvas.height = 0;
      const large = new File([source], "24mp.png"),
        start = performance.now(),
        accepted = await c.loadImage(large),
        inspectMs = performance.now() - start;
      if (!accepted) throw Error(`24MP inspection: ${c.getSnapshot().error}`);
      const points = [
        [0, 0],
        [6000, 0],
        [0, 4000],
        [6000, 4000],
        [3000, 2000],
        [1000, 1000],
        [5000, 3000],
        [4000, 1000],
        [1000, 3000],
        [5000, 1000],
      ].map((image, i) => ({
        id: `large-${i}`,
        label: i + 1,
        enabled: true,
        image,
        target: [1000 + image[0], 5000 - image[1]],
        crs: "EPSG:3857",
      }));
      const fitStart = performance.now();
      c.replaceGcps(points);
      await waitFit();
      const largePreviewMs = performance.now() - fitStart;
      c.setOutput({
        crs: "EPSG:3857",
        resampler: "bilinear",
        resolution: [1, 1],
        rowsPerStrip: 128,
      });
      let ticks = 0;
      const ticking = setInterval(() => ticks++, 10);
      const exportStart = performance.now();
      const output = await c.exportRaster();
      const exportMs = performance.now() - exportStart;
      clearInterval(ticking);
      const outputInfo = {
        width: output?.raster.width,
        height: output?.raster.height,
        bytes: output?.blob.size,
        estimatedBytes: output?.raster.estimatedBytes,
      };
      const cancelStart = performance.now(),
        cancelled = c.exportRaster();
      c.cancelExport();
      await cancelled;
      const cancelMs = performance.now() - cancelStart;
      const bytes = new Uint8Array(await source.arrayBuffer()),
        view = new DataView(bytes.buffer);
      view.setUint32(16, 10000);
      view.setUint32(20, 10000);
      const rejected100mp = !(await c.loadImage(
          new File([bytes], "100mp.png"),
        )),
        rejectedMessage = c.getSnapshot().error;
      await c.removeImage();
      await load(file, "100px fixture");
      const dense = [];
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 16; x++) {
          const image = [(x * 100) / 15, (y * 100) / 7];
          dense.push({
            id: `dense-${x}-${y}`,
            label: dense.length + 1,
            image,
            target: [
              1000 + 2 * image[0] + 0.002 * image[0] * image[1],
              2000 - 3 * image[1] + 0.001 * image[0] ** 2,
            ],
            enabled: true,
            crs: "EPSG:3857",
          });
        }
      const denseStart = performance.now();
      c.replaceGcps(dense);
      c.setModel("thinPlateSpline");
      await waitFit();
      const densePreviewMs = performance.now() - denseStart;
      let requests = 0;
      const features = Array.from({ length: 5000 }, (_, i) => ({
        type: "Feature",
        id: `feature-${i}`,
        properties: { name: `Reference ${i}` },
        geometry: {
          type: "Point",
          coordinates: [1000 + i * 0.01, 1800 + i * 0.01],
        },
      }));
      const referenceStart = performance.now();
      const reference = await v.loadWfs(
        {
          kind: "wfs",
          id: "large",
          label: "large",
          url: "/wfs",
          version: "2.0.0",
          typeNames: ["fixture:points"],
          requestCrs: "EPSG:3857",
          responseCrs: "EPSG:3857",
          axisOrder: "xy",
          responseFormat: "geojson",
          pageSize: 500,
          maxFeatures: 5000,
          request: async (url) => {
            requests++;
            const start = Number(new URL(url).searchParams.get("startIndex"));
            return new Response(
              JSON.stringify({
                type: "FeatureCollection",
                numberMatched: features.length,
                features: features.slice(start, start + 500),
              }),
            );
          },
        },
        {
          extent: [800, 1600, 1300, 2100],
          crs: "EPSG:3857",
          resolution: 1,
          signal: new AbortController().signal,
        },
        "EPSG:3857",
      );
      const referenceMs = performance.now() - referenceStart;
      await c.removeImage();
      window.gc?.();
      return {
        coldImageToPreviewMs,
        cycles: 20,
        resourceCycles,
        urls: window.urlStats,
        previewMs,
        p95: previewMs.toSorted((a, b) => a - b)[18],
        heap,
        large: {
          accepted,
          inputBytes: source.size,
          inspectMs,
          previewMs: largePreviewMs,
          exportMs,
          eventLoopTicks: ticks,
          ...outputInfo,
        },
        cancelMs,
        rejected100mp,
        rejectedMessage,
        dense: {
          gcps: dense.length,
          model: "thinPlateSpline",
          previewMs: densePreviewMs,
        },
        references: {
          count: reference.features.length,
          partial: reference.partial,
          requests,
          elapsedMs: referenceMs,
        },
        workers: window.workerStats,
      };
    });
    await page.evaluate(() => window.gc?.());
    await page.waitForTimeout(1500);
    sample();
    results.push({
      browser: name,
      version: browser.version(),
      assetReadyMs,
      ...result,
      resources: {
        method:
          "100ms ps summed RSS of descendants and new browser-distribution XPC processes (WebKit launchd services included); shared pages may be double-counted; GPU driver/device allocations are not exposed",
        samples: samples.length,
        baselineRssBytes: samples[0]?.rssBytes,
        peakRssBytes: Math.max(...samples.map((s) => s.rssBytes)),
        lastRssBytes: samples.at(-1)?.rssBytes,
        maxProcesses: Math.max(...samples.map((s) => s.processes)),
      },
    });
    writeFileSync(
      "artifacts/reports/benchmark-all.json",
      `${JSON.stringify(
        {
          platform: os.platform(),
          arch: os.arch(),
          cpu: os.cpus()[0].model,
          node: process.version,
          results,
        },
        null,
        2,
      )}\n`,
    );
    console.log({
      browser: name,
      p95: result.p95,
      exportMs: result.large.exportMs,
      peakRSS: results.at(-1).resources.peakRssBytes,
      workers: result.workers,
    });
  } finally {
    clearInterval(timer);
    await browser.close();
    await server.close();
  }
}
