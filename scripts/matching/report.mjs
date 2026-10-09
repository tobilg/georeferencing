import { readFileSync, writeFileSync } from "node:fs";

const node = JSON.parse(readFileSync("artifacts/reports/matching-node.json")),
  resources = JSON.parse(
    readFileSync("artifacts/reports/matching-resources.json"),
  );
const rows = node.results
  .filter((r) => r.detector === "sift" && !r.case.includes("original-"))
  .map((s) => {
    const a = node.results.find(
      (r) => r.detector === "akaze" && r.case === s.case,
    );
    return `| ${s.case} | ${s.cornerError?.toFixed(3) ?? s.status} | ${s.independentInliers ?? 0} | ${s.diagnostics.matchingMs.toFixed(0)} | ${a.cornerError?.toFixed(3) ?? a.status} | ${a.independentInliers ?? 0} | ${a.diagnostics.matchingMs.toFixed(0)} |`;
  });
const akazeRejected = node.results
  .filter(
    (r) =>
      r.detector === "akaze" &&
      r.case !== "negative" &&
      !r.case.includes("original-") &&
      r.status !== "matched",
  )
  .map((r) => r.case);
const akazeKnown = node.results
  .filter((r) => r.detector === "akaze" && r.mayMiss?.includes("akaze"))
  .map((r) => r.case);
const runtimes = [];
for (const name of ["chromium", "firefox", "webkit"]) {
  const data = JSON.parse(
    readFileSync(`artifacts/reports/matching-${name}.json`),
  );
  const positives = (d) => data.filter((r) => r.detector === d && r.expected),
    matched = (d) =>
      positives(d).filter((r) => r.result.status === "matched").length,
    accepted = positives("sift");
  runtimes.push(
    `| ${name} ${data[0]?.runtime ?? "(version not recorded)"} | ${matched("sift")}/8 | ${matched("akaze")}/8 | ${data.find((r) => r.detector === "sift" && !r.expected).result.status} | ${Math.min(...accepted.map((r) => r.result.diagnostics.matchingMs)).toFixed(0)}–${Math.max(...accepted.map((r) => r.result.diagnostics.matchingMs)).toFixed(0)} |`,
  );
}
writeFileSync(
  "benchmarks/matching.md",
  `# Local matching benchmark\n\nMeasured ${node.date} on ${node.cpu}, ${(node.totalMemory / 2 ** 30).toFixed(0)} GiB RAM, ${node.platform}/${node.arch}, Node ${node.runtime}. One scalar WASM worker per matcher. OpenCV 4.12.0/Emscripten 6.0.8. These are fixture measurements, not latency or accuracy promises.\n\nReference acquisition is **0 ms in these compute rows**: decoded local buffers are supplied before timing. Fixture decoding/generation and worker message copies are outside matchingMs; cold initialization is reported separately. Browser tests additionally exercise HTTP WMS acquisition and isolated OpenLayers rendering, recording acquisitionMs separately from matching. No live remote WMS server was benchmarked.\n\nThe query is 331×338, reference 820×1329. Derived rotation/scale/perspective cases record actual dimensions and transforms in JSON. Partial references are 458×1329 and 392×1329; negative is 820×529. Both private file hashes were verified against PRD §10. Image pixels are not reproduced here. Counts are deduplicated independent features, not discovery's raw inliers.\n\n| Fixture | SIFT corner error px | SIFT support | SIFT ms | AKAZE corner error px | AKAZE support | AKAZE ms |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n${rows.join("\n")}\n\nBoth detectors are asserted against the same accuracy thresholds and validation gates. SIFT is the default and matches every positive fixture. AKAZE must match every positive except its known misses (${akazeKnown.join(", ")}), where not-found is accepted but a wrong placement is not; this run it returned not-found for ${akazeRejected.join(", ") || "none"}. Both reject the non-overlapping negative. Repeated-copy ambiguity and repetitive-label rejection use independent synthetic tests, run for both detectors.\n\n| Browser worker | SIFT positives validated | AKAZE positives validated | Negative | SIFT positive compute ms range |\n| --- | ---: | ---: | --- | ---: |\n${runtimes.join("\n")}\n\nBrowser runs apply the same rules to both detectors: ≤1 px original / ≤2 px transformed corner errors and partial fractions within 0.02 for every reported placement. Browser versions above are measured from the pinned Playwright 1.63.0 distribution. Results are in artifacts/reports/matching-{chromium,firefox,webkit}.json.\n\n## Startup, cache and payload\n\n${[
    "sift",
    "akaze",
  ]
    .map((d) => {
      const cold = node.results.find(
          (r) => r.detector === d && r.case === "original",
        ),
        warm = node.results.find(
          (r) => r.detector === d && r.case === "original-warm",
        );
      return `- ${d}: cold worker-local initialization ${cold.diagnostics.initializationMs.toFixed(1)} ms; initial match ${cold.diagnostics.matchingMs.toFixed(0)} ms; cached-reference warm match ${warm.diagnostics.matchingMs.toFixed(0)} ms; heap high-water capacity ${(cold.diagnostics.wasmHeapBytes / 2 ** 20).toFixed(1)} MiB.`;
    })
    .join(
      "\n",
    )}\n\nThe shared artifact includes both detectors: JS ${node.assets["opencv.js"].bytes.toLocaleString()} bytes (${node.assets["opencv.js"].gzip.toLocaleString()} gzip), WASM ${node.assets["opencv.wasm"].bytes.toLocaleString()} bytes (${node.assets["opencv.wasm"].gzip.toLocaleString()} gzip). There is no separate SIFT download. The rejected prebuilt contained additional unrelated modules and omitted SIFT. The installed matching package checks runtime exports and a real perspectiveTransform operation.\n\nCold means a fresh matcher/worker with local filesystem/HTTP assets; this does not measure cold network download or OS disk cache. Browser heap APIs are not portable; WASM heap capacity is recorded everywhere. Node RSS includes host and worker allocations and is a point-in-time sample, not a measured peak. WASM capacity grows and remains reserved until the worker is terminated.\n\n## 25 MP resource case\n\nA deterministic 5000×5000 query matched a 1000×1000 reference in ${(resources.elapsedMs / 1000).toFixed(2)} s (${(resources.diagnostics.matchingMs / 1000).toFixed(2)} s compute), under an explicit 1 GiB matching reservation. ${resources.candidates[0]?.independentInliers ?? 0} independent inliers, ${(resources.candidates[0]?.overlapFraction * 100).toFixed(2)}% geometric overlap, status ${resources.status}. Conservative reservation ${(resources.diagnostics.estimatedMemoryBytes / 2 ** 20).toFixed(1)} MiB; WASM heap ${(resources.diagnostics.wasmHeapBytes / 2 ** 20).toFixed(1)} MiB; RSS before/after ${(resources.rssBefore / 2 ** 20).toFixed(1)}/${(resources.rssAfter / 2 ** 20).toFixed(1)} MiB.\n\nThe original 2048-edge coarse level and a 1536 trial exhausted the fixed 512 MiB WASM limit. The final 1024 coarse edge plus 1024 tiles/96-pixel halos completes. Descriptor self-ambiguity filtering adds quadratic matching work but rejects the repeated-glyph false positive. Large jobs may take tens of seconds; cancellation terminates the worker even inside synchronous calls. No universal minimum-overlap guarantee follows from this sparse synthetic case.\n\n## Reproduce\n\n- pnpm benchmark:matching (private plans required; verifies hashes)\n- node scripts/matching/export-fixtures.mjs\n- pnpm exec playwright test tests/browser/matching.spec.ts\n- node scripts/matching/report.mjs\n- pnpm test:matching (public deterministic fixtures only)\n\nRaw reports stay ignored under artifacts/reports/. The source archive, compatibility patches, whitelist, flags, notices and checked-in artifact hashes are recorded in scripts/matching/ and packages/matching/vendor/provenance.json. Detector/build decisions are recorded in the local ADR. Public CI intentionally skips private-image tests when those files are unavailable; it runs the synthetic suite for both detectors and packed consumer coverage.\n`,
);
