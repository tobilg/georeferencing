# Browser benchmarks

These scripts measure browser processing and cleanup using the shared test harness.
They are development tools, excluded from published packages and the demo build.

From the repository root, build the packages and start the harness in one terminal:

```sh
pnpm build:packages
pnpm dev:harness
```

Run measurements separately from other browser/build workloads:

```sh
node benchmarks/benchmark.mjs
node benchmarks/benchmark-all.mjs
node benchmarks/benchmark-all.mjs --browser=chromium
```

The first script measures Chromium preview latency, twenty image lifecycle cycles,
24-megapixel export, cancellation and oversized-input rejection. The second
also measures process RSS, dense control points and reference loading across
Chromium, Firefox and WebKit. `--browser` selects one browser and preserves previous
records for the others; those older records are not new measurements.

Both scripts accept `HARNESS_URL`, defaulting to `http://127.0.0.1:5174`, and require
installed Playwright browsers. The broader process-memory sampler uses `ps` and
includes macOS browser helper processes. RSS can double-count shared pages and does
not expose all GPU allocations; timings describe the tested machine and workload.

Reports and screenshots go to ignored `artifacts/reports/`. They are measurements,
not golden reference fixtures or claims of production persistence. Test inputs are
shared with `tests/fixtures`; no duplicate images are stored here.
