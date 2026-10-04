# Preparing a release

Publish `@georeferencing/core`, `@georeferencing/plugins` and `@georeferencing/react`.
The workspace root, demo and documentation packages have `private: true` and must
remain unpublished. Use Node 22.12+ and pnpm 12.x.

## Public files

Each npm archive contains only `package.json`, `README.md`, `LICENSE` and `dist/`
(JavaScript, declarations, CSS where applicable, workers and third-party notices).
`pnpm release:check` rebuilds and packs the packages, then inspects actual tarball
contents. It rejects internal documents, source maps and unexpected top-level files.
Keep required notices in `dist/licenses` and adjacent worker license files.

Generated measurements belong under ignored `artifacts/reports/`. ADRs, archived
research and internal delivery/parity reports remain ignored local files.
They must not appear in the source tree being merged publicly. A squash merge
can publish the cleaned tree; pushing a branch that still contains earlier commits
would also make those commits available. Review the resulting public tree separately
from npm contents. Build artifacts, local plans and credentials are not release assets.

Consumer guides include supported capabilities and limitations without linking to
private records. See [capabilities](packages/documentation/guides/capabilities.md).

## Checks

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm test:browser
pnpm test:docs
pnpm test:consumer
pnpm release:check
```

Run builds/packing and consumer/browser checks sequentially: builds replace package
output directories. The consumer check needs network access, Playwright Chromium
and `pdfinfo`; browser tests also need Firefox and WebKit installations.

Independent expected QGIS transforms, invalid-input cases, raster grids and
native datum coordinates are committed in `tests/fixtures`. All regression tests
run without private reports or native GIS tools; missing fixtures fail the tests.
To deliberately regenerate the independent reference fixtures:

```sh
pnpm build:packages
node tests/reference/qgis-reference.mjs
node tests/reference/qgis-invalid-reference.mjs
python3 tests/fixtures/generators/datum-fixture.py
pnpm test
```

Fixture regeneration requires Docker with the pinned QGIS image and native GDAL
for datum coordinates. Review fixture changes before committing them. Comparison
measurements and benchmarks are generated separately as ignored local reports.
Do not describe a new release as fully verified based only on earlier reports.

## Before the first public release

- Confirm ownership/publish access for the npm `@georeferencing` scope and configure
  the intended account or trusted publisher. A GitHub repository name does not
  establish npm scope ownership.
- Confirm the release version and dist-tag. The current version is
  `0.1.0-alpha.2`; use an `alpha` tag for this prerelease rather than `latest`.
- Confirm public redistribution permission for the bundled Hamburg WebP, or replace
  it before publishing the source/demo. Its current provenance file does not establish
  a reuse license. The image is excluded from all npm archives.
- Review the public repository's file list, demo storage labels, license notices,
  README links, API compatibility ranges and declared limitations.
- Run the checks above on the exact release revision. Keep local reports private.

## Publishing, after review

Publish the checked archives, core first because plugins and React depend on it:

```sh
pnpm publish artifacts/georeferencing-core-0.1.0-alpha.2.tgz --access public --tag alpha
pnpm publish artifacts/georeferencing-plugins-0.1.0-alpha.2.tgz --access public --tag alpha
pnpm publish artifacts/georeferencing-react-0.1.0-alpha.2.tgz --access public --tag alpha
```

These commands upload to npm; packing and `release:check` do not. Use the chosen
version in all three paths. Verify registry installation from a fresh consumer
after publication. For automated releases, configure npm trusted publishing for
the actual repository/workflow and use a compatible publishing client.

References: [npm package contents](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#files),
[scoped public packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/),
[trusted publishing](https://docs.npmjs.com/trusted-publishers/).
