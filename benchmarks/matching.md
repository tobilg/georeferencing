# Local matching benchmark

Measured 2026-10-09T13:15:01.653Z on Apple M2, 16 GiB RAM, darwin/arm64, Node v22.22.2. One scalar WASM worker per matcher. OpenCV 4.12.0/Emscripten 6.0.8. These are fixture measurements, not latency or accuracy promises.

Reference acquisition is **0 ms in these compute rows**: decoded local buffers are supplied before timing. Fixture decoding/generation and worker message copies are outside matchingMs; cold initialization is reported separately. Browser tests additionally exercise HTTP WMS acquisition and isolated OpenLayers rendering, recording acquisitionMs separately from matching. No live remote WMS server was benchmarked.

The query is 331×338, reference 820×1329. Derived rotation/scale/perspective cases record actual dimensions and transforms in JSON. Partial references are 458×1329 and 392×1329; negative is 820×529. Both private file hashes were verified against PRD §10. Image pixels are not reproduced here. Counts are deduplicated independent features, not discovery's raw inliers.

| Fixture | SIFT corner error px | SIFT support | SIFT ms | AKAZE corner error px | AKAZE support | AKAZE ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| original | 0.048 | 278 | 1926 | 0.065 | 234 | 1227 |
| rotation37 | 0.247 | 239 | 1962 | 0.075 | 277 | 904 |
| scale065 | 0.321 | 82 | 1673 | not-found | 0 | 806 |
| perspective | 0.254 | 168 | 1797 | 0.323 | 164 | 936 |
| combined | 1.082 | 119 | 1654 | 0.977 | 73 | 1009 |
| annotated-combined | 1.185 | 97 | 1670 | not-found | 0 | 632 |
| partial-362 | 0.052 | 210 | 1332 | 0.017 | 78 | 369 |
| partial-428 | 0.140 | 132 | 1146 | 0.051 | 33 | 292 |
| negative | not-found | 0 | 689 | not-found | 0 | 154 |

Both detectors are asserted against the same accuracy thresholds and validation gates. SIFT is the default and matches every positive fixture. AKAZE must match every positive except its known misses (scale065, annotated-combined), where not-found is accepted but a wrong placement is not; this run it returned not-found for scale065, annotated-combined. Both reject the non-overlapping negative. Repeated-copy ambiguity and repetitive-label rejection use independent synthetic tests, run for both detectors.

| Browser worker | SIFT positives validated | AKAZE positives validated | Negative | SIFT positive compute ms range |
| --- | ---: | ---: | --- | ---: |
| chromium 153.0.8010.12 | 8/8 | 6/8 | not-found | 986–1780 |
| firefox 155.0 | 8/8 | 6/8 | not-found | 1254–2113 |
| webkit 26.6 | 8/8 | 6/8 | not-found | 1082–1921 |

Browser runs apply the same rules to both detectors: ≤1 px original / ≤2 px transformed corner errors and partial fractions within 0.02 for every reported placement. Browser versions above are measured from the pinned Playwright 1.63.0 distribution. Results are in artifacts/reports/matching-{chromium,firefox,webkit}.json.

## Startup, cache and payload

- sift: cold worker-local initialization 26.0 ms; initial match 1926 ms; cached-reference warm match 724 ms; heap high-water capacity 238.5 MiB.
- akaze: cold worker-local initialization 38.0 ms; initial match 1227 ms; cached-reference warm match 449 ms; heap high-water capacity 95.8 MiB.

The shared artifact includes both detectors: JS 159.616 bytes (35.771 gzip), WASM 4.587.752 bytes (1.332.474 gzip). There is no separate SIFT download. The rejected prebuilt contained additional unrelated modules and omitted SIFT. The installed matching package checks runtime exports and a real perspectiveTransform operation.

Cold means a fresh matcher/worker with local filesystem/HTTP assets; this does not measure cold network download or OS disk cache. Browser heap APIs are not portable; WASM heap capacity is recorded everywhere. Node RSS includes host and worker allocations and is a point-in-time sample, not a measured peak. WASM capacity grows and remains reserved until the worker is terminated.

## 25 MP resource case

A deterministic 5000×5000 query matched a 1000×1000 reference in 21.73 s (21.61 s compute), under an explicit 1 GiB matching reservation. 43 independent inliers, 4.00% geometric overlap, status matched. Conservative reservation 765.8 MiB; WASM heap 375.2 MiB; RSS before/after 165.2/687.0 MiB.

The original 2048-edge coarse level and a 1536 trial exhausted the fixed 512 MiB WASM limit. The final 1024 coarse edge plus 1024 tiles/96-pixel halos completes. Descriptor self-ambiguity filtering adds quadratic matching work but rejects the repeated-glyph false positive. Large jobs may take tens of seconds; cancellation terminates the worker even inside synchronous calls. No universal minimum-overlap guarantee follows from this sparse synthetic case.

## Reproduce

- pnpm benchmark:matching (private plans required; verifies hashes)
- node scripts/matching/export-fixtures.mjs
- pnpm exec playwright test tests/browser/matching.spec.ts
- node scripts/matching/report.mjs
- pnpm test:matching (public deterministic fixtures only)

Raw reports stay ignored under artifacts/reports/. The source archive, compatibility patches, whitelist, flags, notices and checked-in artifact hashes are recorded in scripts/matching/ and packages/matching/vendor/provenance.json. Detector/build decisions are recorded in the local ADR. Public CI intentionally skips private-image tests when those files are unavailable; it runs the synthetic suite for both detectors and packed consumer coverage.
