# Releasing

Releases are published by GitHub Actions. Pushing a `v*` tag runs
[`release.yml`](.github/workflows/release.yml), which:

1. checks that the tag matches the version of every public package (listed in
   [`scripts/packages.mjs`](scripts/packages.mjs));
2. runs the complete [CI workflow](.github/workflows/ci.yml): lint, types, unit
   tests, browser tests in Chromium/Firefox/WebKit, clean-consumer tests,
   documentation checks, and packing with a tarball-content check;
3. publishes the tarballs that CI verified to npm with
   [trusted publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC, no npm
   token) and provenance: `@georeferencing/core` first, then `plugins`, `matching`, `react`,
   `openlayers`, `maplibre` and `leaflet`;
4. deploys the documentation site and the demo that CI built to Cloudflare Pages:

   | Site | Pages project | URL |
   | --- | --- | --- |
   | API documentation | `georeferencing-api-docs` | https://georeferencing-api-docs.gh.tobilg.com |
   | Demo | `georeferencing-demo` | https://georeferencing-demo.gh.tobilg.com |

5. creates a GitHub release with generated notes and the tarballs attached.

The workspace root, demo and documentation packages are `private: true` and are
never published.

## Versioning

`@georeferencing/core`, `@georeferencing/plugins`, `@georeferencing/react` and the
map adapters `@georeferencing/openlayers`, `@georeferencing/maplibre` and
`@georeferencing/leaflet` always share one version. Every package except core declares
core as a peer dependency with a
caret range on that version (packed from `workspace:^`), so applications always install
exactly one core; users are told to install matching versions.

The npm dist-tag follows the version: `1.2.3` publishes as `latest`, and
`1.2.3-beta.4` publishes as `beta` (likewise `alpha`, `rc`, …), so prereleases
never move `latest`. The first release is `v0.1.0`.

## Publish a release

```sh
git switch main && git pull
pnpm version:set 0.1.1      # updates all packages and ENGINE_VERSION
git commit -am "Release v0.1.1"
git tag v0.1.1
git push origin main v0.1.1
```

Then watch the **Release** workflow. To check a release without publishing,
run the workflow manually from the Actions tab with **Dry run** enabled. It runs
all checks and `npm publish --dry-run`, and deploys nothing. Real releases must
run on a tag. The Pages sites are deployed **only** by a pushed `v*` tag, so they
always match a published release; pushes to `main` and manual runs never update them.

Re-running a failed release is safe: package versions that are already on npm are
skipped, and the remaining packages, the Pages sites and the GitHub release are
completed.

After publishing, verify a registry installation in a fresh project and check
the dist-tags with `npm dist-tag ls @georeferencing/core`.

## One-time setup

### npm trusted publishing

For **each** public package (`core`, `plugins`, `matching`, `react`, `openlayers`, `maplibre`
and `leaflet` in the `@georeferencing` scope), open the package's
**Settings → Trusted publishing** on
npmjs.com and add a GitHub Actions publisher:

| Field | Value |
| --- | --- |
| Organization or user | `tobilg` |
| Repository | `georeferencing` |
| Workflow filename | `release.yml` |
| Environment | leave empty |

npm configures trusted publishers per existing package. If the settings page is
not available because a package has never been published, bootstrap `v0.1.0`
manually from the release commit (logged in as a member of the `@georeferencing`
org), then add the trusted publishers:

```sh
git switch --detach v0.1.0          # after creating the tag locally
pnpm install --frozen-lockfile
pnpm release:check
npm publish ./artifacts/georeferencing-core-0.1.0.tgz --access public
npm publish ./artifacts/georeferencing-plugins-0.1.0.tgz --access public
npm publish ./artifacts/georeferencing-react-0.1.0.tgz --access public
```

Packages added later (`openlayers`, `maplibre` and `leaflet` were added for 0.4.0)
need the same bootstrap for their first version: publish only the new packages'
tarballs manually, add their trusted publishers, then push the tag. The release
workflow checks this first: if any public package is not on npm yet, it stops
before running CI or publishing anything.

Then push the `v0.1.0` tag. The release workflow skips the already-published
packages and completes the Pages deployments and the GitHub release. Manually
published versions carry no provenance; every later release published by the
workflow does.

After that, consider setting each package's **Publishing access** to require
two-factor authentication and disallow tokens, so only the workflow can publish.

npm generates provenance only for workflows in **public** repositories. Make the
repository public before the first CI release.

### Cloudflare Pages

1. Create two Pages projects (Workers & Pages → Create → Pages → Direct upload):
   `georeferencing-api-docs` and `georeferencing-demo`. The names must match the
   `deploy-pages` matrix in `release.yml`.
2. In each project's **Custom domains**, add `georeferencing-api-docs.gh.tobilg.com`
   and `georeferencing-demo.gh.tobilg.com` respectively. All README, package and
   documentation links use these domains.
3. Create an API token with the **Cloudflare Pages: Edit** permission.
4. Add repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

Deployments go to each project's production branch (`--branch main`), so the
custom domains always serve the latest release. Both sites use relative links and
need no rebuild for a different domain. The demo loads OpenStreetMap tiles directly
from the visitor's browser; keep its traffic within the
[OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

## Package contents

Each npm archive contains only `package.json`, `README.md`, `LICENSE` and `dist/`
(JavaScript, declarations, CSS where applicable, workers and third-party
notices). `pnpm release:check` rebuilds and packs the packages, then inspects the
actual tarballs and rejects source maps, internal documents and unexpected files.
Keep required notices in `dist/licenses` and next to worker bundles.

## Reference fixtures

The regression tests use the committed QGIS, raster and datum fixtures in
`tests/fixtures` and need no GIS installation. To regenerate them deliberately:

```sh
pnpm build:packages
node tests/reference/qgis-reference.mjs
node tests/reference/qgis-invalid-reference.mjs
python3 tests/fixtures/generators/datum-fixture.py
pnpm test
```

This needs Docker with the pinned QGIS image and native GDAL for the datum
coordinates. Review fixture changes before committing them.

Matching ships its pinned local OpenCV WASM and third-party notices. Run the packed consumer gate; rebuilding WASM is explicit (`scripts/matching/build-opencv.sh`), not an install-time network operation. Never add private `plans/` or derived `artifacts/matching/` fixtures to a release.
