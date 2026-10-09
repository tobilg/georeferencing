import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { transform } from "../../packages/matching/dist/geometry.js";
import { createNodeMatcher } from "../../packages/matching/dist/node.js";
import { createSnapshot } from "../../packages/matching/dist/reference.js";

// Deterministic distributed drawing at 25 MP; entire selected region is searched.
const width = 5000,
  height = 5000,
  data = new Uint8Array(width * height * 4);
data.fill(255);
let seed = 42;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
for (let n = 0; n < 1200; n++) {
  const x = 20 + Math.floor(random() * 4920),
    y = 20 + Math.floor(random() * 4920),
    w = 8 + Math.floor(random() * 28),
    h = 8 + Math.floor(random() * 28);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++)
      if (
        i < 2 ||
        j < 2 ||
        i > w - 3 ||
        j > h - 3 ||
        Math.abs(i - j * 0.7) < 2
      ) {
        const p = ((y + j) * width + x + i) * 4;
        data[p] = data[p + 1] = data[p + 2] = 50;
      }
}
const referenceData = new Uint8Array(1000 * 1000 * 4);
for (let y = 0; y < 1000; y++)
  referenceData.set(
    data.subarray(
      ((y + 1500) * 5000 + 1500) * 4,
      ((y + 1500) * 5000 + 2500) * 4,
    ),
    y * 4000,
  );
const reference = createSnapshot({
  id: "resources-1",
  width: 1000,
  height: 1000,
  crs: "EPSG:3857",
  extent: [0, 0, 1000, 1000],
  source: { id: "synthetic", revision: "1", layers: ["plan"] },
  tiles: [{ x: 0, y: 0, width: 1000, height: 1000, data: referenceData }],
});
const matcher = createNodeMatcher(),
  start = performance.now(),
  rssBefore = process.memoryUsage().rss;
try {
  const result = await matcher.match({
    query: { width, height, data },
    reference,
    options: { maxMemoryBytes: 1024 * 1024 * 1024 },
  });
  const evidence = {
    runtime: process.version,
    cpu: os.cpus()[0].model,
    totalMemory: os.totalmem(),
    query: [width, height],
    reference: [1000, 1000],
    elapsedMs: performance.now() - start,
    rssBefore,
    rssAfter: process.memoryUsage().rss,
    status: result.status,
    diagnostics: result.diagnostics,
    candidates: result.candidates.map((c) => ({
      ...c,
      correspondences: undefined,
    })),
  };
  mkdirSync("artifacts/reports", { recursive: true });
  writeFileSync(
    "artifacts/reports/matching-resources.json",
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify(evidence));
  assert.equal(result.status, "matched");
  assert.equal(result.candidates[0].extentStatus, "partial");
  assert(Math.abs(result.candidates[0].overlapFraction - 0.04) < 0.002);
  const origin = transform(result.candidates[0].transform, [1500, 1500]);
  assert(Math.hypot(...origin) < 1);
  assert(result.diagnostics.wasmHeapBytes <= 512 * 1024 ** 2);
  assert(result.diagnostics.estimatedMemoryBytes <= 1024 ** 3);
} finally {
  matcher.dispose();
}
