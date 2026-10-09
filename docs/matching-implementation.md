# Matching implementation record

The local PRD is `plans/georeferencing-image-matching-prd.md` (read in full).
Both local image SHA-256 hashes match section 10. These ignored files remain local;
public tests use generated geometry owned by this project.

## Implementation plan — completed

1. Audit repository instructions, exports, controller, coordinates, adapters and releases;
   verify pinned OpenCV runtime capabilities with executable Node/browser matching.
2. Add the optional package, shared bounded pixel engine, independent candidate validation,
   ranking, coverage and worker lifecycle.
3. Add immutable reference acquisition, native OpenLayers integration, optional editor
   review and explicit controller application.
4. Add reproducible private experiments, public synthetic tests, packaged consumers,
   API/usage documentation and repository regression gates.

## Acceptance traceability

Evidence uses the shipped WASM, not native Python. Private-image tests are optional in
public CI because redistribution permission is unknown. The files were available and
hash-verified for the local measurements linked below.

| AC | Implemented behavior and evidence |
| --- | --- |
| AC-01 | Original crop in Node and all three browser workers, <=1 px corner error and complete coverage. `scripts/matching/benchmark.mjs`, `tests/browser/matching.spec.ts`, `benchmarks/matching.md`. |
| AC-02 | Rotation 37°, scale .65, perspective and combined fixtures, <=2 px. `scripts/matching/fixtures.mjs`, Node/browser fixture reports. |
| AC-03 | Red annotations, reduced contrast and combined geometry pass with normalized SIFT. Same runtime recipes/reports; AKAZE limitation retained and documented. |
| AC-04 | Both annotated partial fixtures pass <=2 px and overlap within .02 in query coordinates. Same fixture suite; geometry clipping in `tests/matching.test.ts`. |
| AC-05 | The lower-target negative returns not-found with no selectable candidate. Node/browser private fixtures; weak, implausible and unstable models rejected in `src/validation.ts`. |
| AC-06 | Blank, near-blank, unrelated, repeated parallel lines/labels, collinear support and projective poles rejected. `tests/matching.test.ts`. |
| AC-07 | Two copied locations yield two distinct, deterministically ordered ambiguous candidates; repeated request preserves footprints. `tests/matching.test.ts`. |
| AC-08 | Stronger partial location outranks a weaker complete location. `tests/matching.test.ts` dedicated evidence-ranking fixture. |
| AC-09 | Crop/resize/centre/inverse bookkeeping, actual cropped-region recovery, DPR 2 and controller-normalized orientation-6 JPEG matching. `tests/matching.test.ts`, `tests/browser/matching.spec.ts`; all eight JPEG/PNG/WebP normalization regressions remain in `tests/browser/formats.spec.ts`. |
| AC-10 | Seam-crossing placement agrees with the equivalent untiled reference within .1 px and remains complete. `tests/matching.test.ts`. |
| AC-11 | HTTP WMS GetMap workflow preserves filters/time/extent/CRS/dimensions; EPSG:4326 1.3/1.1 axis tests; alpha availability stays distinct from containment. Native OpenLayers loaded vector/WFS pixels use the same matcher in the existing demo/browser integration. `tests/matching.test.ts`, `tests/browser/matching.spec.ts`. No live production IVL WMS server was benchmarked. |
| AC-12 | 5000×5000 query completes with a recorded 1 GiB reservation. Preallocation pixel/side/tile/feature/memory checks and coherent demo/core opt-in. `scripts/matching/resources.mjs`, `tests/matching.test.ts`, `MATCHING_CORE_LIMITS`, benchmark report. |
| AC-13 | Worker responsiveness/progress, initialization/computation cancellation, transport/decode cancellation, recovery and idempotent disposal. Stale messages and live-worker counts checked across repeated aborts. `tests/matching-lifecycle.test.ts`, `tests/matching.test.ts`, browser harness. Matrices use finally/delete; cached-reference warm jobs expose retained heap capacity (not a portable browser RSS peak). |
| AC-14 | Explicit merge/replace applies <=16 spatially distributed verified points, CRS and source provenance, through atomic controller replacement. Manual points/history preserved; stale token rejected and undo restores points/model. `tests/matching-apply.test.ts`, demo browser test; existing controller tests cover point budgets. |
| AC-15 | Existing manual fit/preview/save/export suites; packed consumers verify no matching/WASM request before invocation and core bundle excludes it. `pnpm test`, `pnpm test:browser`, `scripts/consumer.mjs`. |
| AC-16 | Clean tarball-only Node and Vite browser consumers load local assets, including CSP without JavaScript unsafe-eval; all browser engines run actual detectors. Unsupported exports produce BACKEND errors. `tests/consumers/matching-node.mjs`, `scripts/consumer.mjs`, browser suite, `tests/matching.test.ts`. |
| AC-17 | Package README, generated API pages, typechecked browser/Node examples, source capability matrix, resources/semantics/CSP and backend ADR. `packages/matching/README.md`, `packages/documentation/guides/matching.md`, `docs/adr/automatic-matching.md`. |
| AC-18 | Actual versions, dimensions, independent support, accuracy, cold initialization, warm cache, assets, compute/acquisition separation and available memory metrics. `benchmarks/matching.md`, `scripts/matching/{benchmark,resources,report}.mjs`, ignored `artifacts/reports/matching-*.json`. |

## Repository and delivery audit

Clean initial working tree; no applicable AGENTS.md. Public packages are 0.4.0,
listed in `scripts/packages.mjs`; compilation uses TypeScript plus bundled workers.
Core owns projection, domain validation, history and EXIF image normalization.
Its 24 MP defaults remain unchanged; matching has an explicit compatible 25 MP
input opt-in and separate output limits. No unrelated dependency upgrades.

New package exports: root contracts/providers/application, `/browser`, `/node`,
`/openlayers`, `/worker`, `/opencv.js`, `/opencv.wasm`. The matching package ships no
UI, React dependencies or styles. Review controls and candidate overlays live in
the private demo; hosts implement their own workflow. Generated declarations,
local assets, artifact hashes, license notices, versioning, package-content checking,
clean consumers and documentation navigation are integrated with existing tooling.

## Validation record

Validated locally on 2026-10-08, Node 22.22.2, pnpm 12.4.2, Apple M2 / 16 GiB.
Logs and runtime reports remain under `artifacts/matching/` and `artifacts/reports/`.

| Command | Result |
| --- | --- |
| `pnpm build` | Passed all public packages, demo and API site; Vite's large-chunk advisory remains nonfatal. |
| `pnpm lint` | Passed, 202 files. |
| `pnpm typecheck` | Passed workspace declarations, demo, documentation examples and root tests. |
| `pnpm test` | 269 tests passed in 15 files. |
| `pnpm test:matching` | Final focused run: 21 tests passed in 3 files, including stable heap capacity over repeated cached jobs. |
| `pnpm test:browser` | 117 passed: Chromium 153.0.8010.12, Firefox 155.0 and WebKit 26.6. |
| `pnpm exec playwright test tests/browser/matching.spec.ts` | 15 passed, including all private fixtures and the EXIF-to-matching path. |
| `pnpm exec playwright test tests/browser/matching.spec.ts -g 'WMS\|existing editor'` | Final provider refinements: 6 passed across all three engines. |
| `pnpm exec tsc --noEmit` | Passed again after final tests/provider refinements. |
| `pnpm test:consumer` | Passed clean Node and Vite/browser installations from local tarballs, SSR imports, optional UI peers, lazy WASM and CSP loading. |
| `pnpm test:docs` | Passed: 239 pages, 11,891 local links/assets, 756 source links, navigation/search and embedded example. |
| `pnpm release:check` | Passed seven public 0.4.0 archives, including matching assets, declarations and notices. |
| `pnpm benchmark:matching` | Passed default-detector accuracy/status assertions and the 25 MP resource assertion. |
| `node scripts/matching/report.mjs` | Generated `benchmarks/matching.md` from recorded Node/browser/resource results. |
| `git diff --check` | Passed. |

The first packed-browser run exposed Embind JavaScript evaluation under CSP; the
artifact was rebuilt with `DYNAMIC_EXECUTION=0` and the consumer passed. The added
WebKit EXIF test initially produced conflicting EXIF records because its JPEG
encoder already emits APP1 metadata; replacing that record fixed the fixture, and
the full browser rerun passed. No thresholds were weakened for either failure.

No checks remain environmentally blocked. Private-image tests ran locally; public
CI skips them explicitly if unavailable. No npm publication, deployment, push or
external plan upload was performed.

## Deliberate limits

- Scalar single-threaded OpenCV 4.12.0, SIFT default; AKAZE is faster but rejects the
  annotated-combined case under the same policy. No lowered fallback thresholds.
- Search defaults to 32 MP reference pixels; native isolated vector rendering to
  8 MP. Native acquisition supports one WMS source or loaded vector layers. Mixed
  compositions, other adapters and special coordinate mappings use host providers.
- Normalized plans with substantially independent drawing styles can still fail;
  fixture results are not calibrated confidence or survey accuracy.
- Browser/GPU/host decoding memory is outside the WASM heap metric. The 25 MP
  resource fixture uses sparse deterministic linework and does not promise general
  completion latency or a universal minimum overlap.
- Private fixtures are not committed or shipped; public CI explicitly skips them
  when absent and runs project-owned synthetic and packaged-consumer coverage.
