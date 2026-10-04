# Packed-package consumers

These private application fixtures prove that published exports, declarations,
CSS and workers work outside this workspace. They are not pnpm workspace packages
and are not included in npm archives.

Run `pnpm test:consumer` from the repository root. The shared runner in
`scripts/consumer.mjs` builds/packs the three public packages, checks archive
contents, and copies these fixtures to independent temporary directories. It
injects absolute tarball dependencies and installs there without workspace links.
It also copies and typechecks the documentation examples in the React consumer.

- `react/`: explicit compatibility versions, a React/OpenLayers host, Vite build,
  SSR import checks, and a server that enforces the deployment prefix and CSP.
- `headless/`: core-only SSR/bundle checks, followed by plugin typechecking in an
  installation without React or OpenLayers.

The React server asks the OS for an available port and returns its URL only once
listening. It can coexist with `pnpm dev:harness` on port 5174. The runner owns and
closes its server and browser. Fixture dependency versions are deliberate test
inputs; changing demo dependencies does not change the tested consumer matrix.

Requirements: pnpm 12, Node 22.12+, registry access or a populated package store,
Playwright Chromium and native `pdfinfo`. The resulting report is local-only at
`artifacts/reports/consumer.json`; temporary installation paths are included for
inspection. Tarballs and exported test files remain under ignored `artifacts/`.
Do not run this runner concurrently with other builds or checks reading package
`dist/` directories, because packing rebuilds those directories.
