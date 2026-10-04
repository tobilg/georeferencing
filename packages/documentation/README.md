# Georeferencing API

Documentation for the browser georeferencing workspace: headless sessions and
processing in `@georeferencing/core`, optional local exports in
`@georeferencing/plugins`, and a React 19 editor in `@georeferencing/react`.

This README is both the documentation website's landing page and the operating
guide for the private **`@georeferencing/documentation`** workspace. The site is
generated directly from the three public packages' TypeScript comments, alongside
handwritten guides and typechecked code examples. The same API comments ship in
published `.d.ts` files for editor help. This workspace is not published to npm.

## Choose a package

| Package | Responsibility | Publication |
| --- | --- | --- |
| `@georeferencing/core` | Documents, fitting/warping, worker processing, references, map binding and host-save coordination | Public library |
| `@georeferencing/plugins` | Opt-in GeoTIFF, JPEG, PDF and data exports | Public library |
| `@georeferencing/react` | Ready-made editor, composable panels, hook and scoped styles | Public library |
| `@georeferencing/demo` | Synthetic host integration and browser-validation pages | Private app |
| `@georeferencing/documentation` | This generated API site and guides | Private site |

Core enables no output formats by default. Add only the plugins your host needs;
feature persistence does not require raster export. Processing runs in browser
workers. Reference requests and explicit host save callbacks may use the network;
image fitting, warping and encoding require no raster backend.

The packages support a bounded ordinary-image workload. The
[capabilities and limits](./guides/capabilities.md)
describes supported models, coordinate conventions and deliberate limits.
The [release guide](https://github.com/tobilg/georeferencing/blob/main/RELEASING.md)
explains package contents and release checks.

## Start with the guides

For an end-to-end host application, begin with the [integration guide](./guides/getting-started.md).

| Guide | What it covers |
| --- | --- |
| [Capabilities and limits](./guides/capabilities.md) | Models, formats, resource budgets and integration boundaries |
| [Getting started](./guides/getting-started.md) | Installation, version alignment, a typed host-map integration and composable UI |
| [Optional export plugins](./guides/export-plugins.md) | Format configuration, results and custom exporters |
| [Coordinates and raster output](./guides/coordinates-and-output.md) | Pixel conventions, CRS spaces, models, residual formulas, resampling and output limits |
| [Reference data](./guides/reference-data.md) | WFS axes/paging/authentication, borrowed layers, custom loaders, snapping and incomplete results |
| [Lifecycle and saving](./guides/lifecycle-and-saving.md) | Image replacement, guards, confirmation, review, immutable saves and resource ownership |
| [Workers, packaging and deployment](./guides/workers-and-deployment.md) | Lazy assets, budgets, cancellation, npm packaging, CSP and static hosting |

For package-specific walkthroughs, see the repository READMEs for
[core](https://github.com/tobilg/georeferencing/blob/main/packages/core/README.md),
[plugins](https://github.com/tobilg/georeferencing/blob/main/packages/plugins/README.md),
[React](https://github.com/tobilg/georeferencing/blob/main/packages/react/README.md)
and the [demo](https://github.com/tobilg/georeferencing/blob/main/packages/demo/README.md).

## Public entry points

| Import | Purpose |
| --- | --- |
| `@georeferencing/core` (also `/core`) | Serializable documents, controller, transforms, projections, geometry and interchange |
| `@georeferencing/core/engine` | Lazy processing workers, raster helpers and scheduler |
| `@georeferencing/core/openlayers` | Host-map integration, reference providers and WFS discovery |
| `@georeferencing/core/worker` | Bundled processing-worker asset |
| `@georeferencing/core/encoder-worker` | Optional custom raster codec-worker protocol |
| `@georeferencing/plugins` | Lazy factories and types, also available through `/geotiff`, `/jpeg`, `/pdf` and `/data` |
| `@georeferencing/plugins/tiff` | Low-level TIFF encoding and validation |
| `@georeferencing/plugins/report` | Low-level PDF creation and optional map capture |
| `@georeferencing/plugins/geotiff-worker`, `/jpeg-worker` | Bundled codec-worker assets |
| `@georeferencing/react` | Ready-made editor, panels, types and subscription hook |
| `@georeferencing/react/styles.css` | Optional scoped editor styles |

Use the site's search and module navigation for full signatures, public properties
and source links. Worker asset entries are intended for worker loading, not
ordinary SSR imports. API signatures and guides preserve the separation between
source pixels, reference/working/map CRSs, raster output and geographic features.

## Run this documentation workspace

Use **Node.js 22.12+** and **pnpm 12.x**. A compatible major version is sufficient;
there is no exact pnpm pin. Execute commands from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm docs:dev
```

The site is served at **http://127.0.0.1:4174/**. The root command first builds the
public packages, then generates the site and starts TypeDoc watch plus a Vite
server. Source comments and guides rebuild while you work. Configuration changes
restart the TypeDoc watcher. Stop the command to stop its watcher/server children.
The strict port setting prevents silently choosing a different port.

| Root command | Purpose |
| --- | --- |
| `pnpm docs:dev` | Build prerequisites, generate, watch and serve the site |
| `pnpm docs:build` | Build prerequisites and emit the static site |
| `pnpm docs:preview` | Serve the existing site build on port 4174 |
| `pnpm docs:check` | Validate TypeDoc without writing HTML; build package prerequisites first on a clean checkout |
| `pnpm typecheck` | Compile public declarations and check source, demo, guide examples and tests |
| `pnpm test:docs` | Build docs, check generated links/assets and exercise navigation/search in Chromium |

Direct package commands are available through
`pnpm --filter @georeferencing/documentation run <script>`. Prefer root commands
on a clean checkout because they build dependency declarations first. This package
has no runtime web framework or required external documentation service; TypeDoc
provides static navigation, search and light/dark presentation.

## Source layout and generation

| File / directory | Role |
| --- | --- |
| `README.md` | Website landing page and workspace operating guide |
| `typedoc.json` | Public entry points, guides, strict documentation validation, source links and output routing |
| `tsconfig.api.json` | API-source compilation, mapping cross-package core imports to source |
| `tsconfig.json` | Strict checks for standalone guide examples against package exports |
| `guides/*.md` | Handwritten project documents included in the website |
| `examples/*` | Real TypeScript/TSX snippets embedded in guides |
| `scripts/dev.mjs` | Owns the TypeDoc watcher and local server lifecycle |
| `scripts/check.mjs` | Checks generated links, source links, navigation and search with `pnpm --filter @georeferencing/documentation run test` |
| `dist/` | Generated HTML, assets and search index; ignored build output |

The configured source entries cover core's headless, engine, encoder protocol and
OpenLayers APIs; React's editor/panels; and the plugin root, format factories,
TIFF encoder, pure serializers and PDF report APIs. Private/protected/internal/external symbols are
excluded. Source links point at the repository's `main` branch. The published site is
deployed from each release tag.

TypeDoc currently uses the built-in HTML theme and `structure-dir` routing.
Do not edit generated HTML. Edit source comments, this README or the guides, then
regenerate. The documentation build fails for undocumented required public symbols
and warnings such as invalid API links. Website tooling remains a development
dependency of this private workspace, outside consumer runtime dependencies.

## Contribute API documentation and guides

1. Document behavior in the owning public TypeScript source: purpose, coordinate
   units, ownership, revision/cancellation guarantees and meaningful parameter or
   error conditions. Avoid comments that merely restate a symbol's name.
2. For a new public API entry, export it from its package and add the appropriate
   source entry to `typedoc.json`. Keep `tsconfig.api.json` source mappings coherent
   when cross-package imports change.
3. Put runnable guide examples in `examples/`, importing public package entry points.
   Embed them in guides with TypeDoc's `includeCode` directive instead of
   maintaining an untested duplicate. Paths are relative to the guide file.
4. Give each guide a title in its frontmatter and link it from this landing page.
   Use relative Markdown links for included guides and repository links for source
   files that are not emitted as site pages.
5. Run typechecking, documentation validation and the generated-site check before
   considering the change complete.

The required TypeDoc coverage includes modules, functions, classes, interfaces,
constructors, properties, methods, accessors, type aliases, variables and enums.
Do not disable strict validation to hide a missing public contract. Keep examples
explicit about synthetic coordinates and injected host persistence. Downloading a
session is not a save acknowledgement, and optional plugin code must not become
an implicit core dependency through documentation examples.

## Validation and static hosting

```sh
pnpm typecheck
pnpm lint
pnpm test:docs
```

The browser check requires Playwright Chromium. If it is absent, install it using
`pnpm exec playwright install chromium` on a machine permitting downloads.
The checker serves the generated output under `/api/`, traverses local links,
assets and anchors, verifies source links for all three public packages, and
exercises guide code, navigation and search. It writes a local result artifact to
`artifacts/reports/documentation-validation.json`.

`pnpm docs:build` emits `packages/documentation/dist`. Deploy the complete output
directory, including assets/search data, with a static server that resolves
folder URLs to `index.html`. Internal links/assets are relative, so a non-root
base such as `/api/` is supported. Local builds and previews do not deploy. The
[release workflow](https://github.com/tobilg/georeferencing/blob/main/RELEASING.md)
deploys the site built by CI to [georeferencing-api-docs.gh.tobilg.com](https://georeferencing-api-docs.gh.tobilg.com)
for every release tag.

## Troubleshooting and license

| Symptom | Action |
| --- | --- |
| Missing package declarations | Run root `pnpm build:packages`, then retry docs/checks |
| Public symbol is undocumented | Add the comment in its owning source; read the exact TypeDoc warning |
| Duplicate or unresolved cross-package types | Inspect source entries and `tsconfig.api.json` paths |
| Guide code is not updated | Edit the included example file and verify the include path |
| Site is stale during preview | Run `pnpm docs:build`; preview serves existing output only |
| Port 4174 is occupied | Stop the conflicting local server before using the strict-port commands |
| Nested pages or search fail after hosting | Upload the entire `dist`, preserve relative paths and serve directory indexes |
| Browser verification cannot launch | Install the matching Playwright Chromium binary and permit local server access |

Documentation and repository source use the MIT license. Redistribution of the
library workers also requires their bundled notices; see the public package
READMEs and deployment guide.
