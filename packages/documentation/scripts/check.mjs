import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const output = join(root, "packages/documentation/dist");
const origin = "https://documentation.invalid";
const prefix = "/api/";
const files = await readdir(output, { recursive: true });
const pages = files.filter((file) => file.endsWith(".html"));
assert(pages.length > 50, "Expected complete public API pages");
for (const route of [
  "",
  "browser/",
  "node/",
  "openlayers/",
  "leaflet/",
  "maplibre/",
  "ImageMatcher/",
  "MatchOptions/",
  "ReferenceSnapshot/",
  "MatchCandidate/",
  "applyCandidate/",
  "createWmsProvider/",
])
  assert(
    pages.includes(`_georeferencing/matching/${route}index.html`),
    `Missing matching API page: ${route}`,
  );
assert(
  pages.includes("Automatic_plan_matching/index.html"),
  "Missing matching guide",
);
assert(
  !pages.some((file) => file.startsWith("_georeferencing/matching/react/")),
  "Removed matching UI must not remain in generated API docs",
);
const htmlByFile = new Map(
  await Promise.all(
    pages.map(async (file) => [
      resolve(output, file),
      await readFile(join(output, file), "utf8"),
    ]),
  ),
);
const decodeHtml = (value) =>
  value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));

async function localPath(pathname) {
  assert(
    pathname.startsWith(prefix),
    `Link escapes deployment base: ${pathname}`,
  );
  let path = resolve(output, decodeURIComponent(pathname.slice(prefix.length)));
  assert(
    path === output || path.startsWith(output + sep),
    `Path escapes website output: ${pathname}`,
  );
  if ((await stat(path)).isDirectory()) path = join(path, "index.html");
  return path;
}

let linkCount = 0;
const sourceLinks = [];
for (const [path, html] of htmlByFile) {
  const url = new URL(prefix + relative(output, path), origin);
  assert(
    !html.includes("{@includeCode"),
    `Unexpanded guide example in ${path}`,
  );
  for (const [, raw] of html.matchAll(/(?:href|src)="([^"]*)"/g)) {
    if (!raw || raw.startsWith("data:") || raw.startsWith("mailto:")) continue;
    const link = new URL(decodeHtml(raw), url);
    if (link.origin !== origin) {
      if (
        /\/blob\/main\/packages\/(core|plugins|matching|react|openlayers|maplibre|leaflet)\/src\//.test(
          link.href,
        )
      ) {
        sourceLinks.push(link.href);
      }
      continue;
    }
    const target = await localPath(link.pathname);
    assert((await stat(target)).isFile(), `Missing asset ${raw} from ${path}`);
    if (link.hash && target.endsWith(".html")) {
      const anchor = decodeURIComponent(link.hash.slice(1));
      assert(
        htmlByFile.get(target)?.includes(`id="${anchor}"`),
        `Missing anchor ${raw} from ${path}`,
      );
    }
    linkCount++;
  }
}
assert(sourceLinks.length > 100, "Expected source links to the workspaces");
for (const name of [
  "core",
  "plugins",
  "matching",
  "react",
  "openlayers",
  "maplibre",
  "leaflet",
]) {
  assert(
    sourceLinks.some((link) => link.includes(`/packages/${name}/src/`)),
    `Missing source links for ${name}`,
  );
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
};
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, origin);
    const path = await localPath(url.pathname);
    response.setHeader(
      "Content-Type",
      types[extname(path)] ?? "application/octet-stream",
    );
    createReadStream(path).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
});
let browser;
try {
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  const base = `http://127.0.0.1:${server.address().port}${prefix}`;
  browser = await chromium.launch();
  const page = await browser.newPage();
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400)
      failures.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(base);
  await expect(
    page.getByRole("heading", { name: "Georeferencing API", exact: true }),
  ).toBeVisible();
  // The landing page has a single title and documents only the public packages.
  await expect(page.locator(".col-content h1")).toHaveCount(1);
  const landing = await page.locator(".col-content").innerText();
  for (const name of ["@georeferencing/demo", "@georeferencing/documentation"])
    assert(!landing.includes(name), `Landing page mentions private ${name}`);
  // Navigation: guides, then one group per public package with its entry points.
  // Sidebar labels contain zero-width breaks after "/" (theme/navigation.js).
  const navigation = page.locator(
    ".site-menu nav.tsd-navigation:not(#tsd-sidebar-links)",
  );
  await expect(navigation.locator("summary").first()).toBeVisible();
  const groups = await navigation
    .locator(":scope > ul > li > details > summary")
    .evaluateAll((elements) =>
      elements.map((element) =>
        element.textContent.replaceAll("\u200b", "").trim(),
      ),
    );
  assert.deepEqual(groups, [
    "Guides",
    "@georeferencing/core",
    "@georeferencing/plugins",
    "@georeferencing/matching",
    "@georeferencing/react",
    "@georeferencing/openlayers",
    "@georeferencing/maplibre",
    "@georeferencing/leaflet",
  ]);
  assert(
    !(await navigation.innerText()).includes("packages/"),
    "Navigation contains a source-path module",
  );
  await page
    .getByRole("link", { name: "integration guide", exact: true })
    .click();
  await expect(
    page
      .getByRole("heading", { name: "Getting started", exact: false })
      .first(),
  ).toBeVisible();
  await expect(
    page.locator("pre").filter({ hasText: "export function createEditor" }),
  ).toBeVisible();
  await page.locator("#tsd-search-trigger").click();
  await page.locator("#tsd-search-input").fill("GeoreferencerController");
  const result = page
    .locator("#tsd-search-results a")
    .filter({ hasText: "GeoreferencerController" })
    .first();
  await expect(result).toBeVisible();
  await result.click();
  await expect(page).toHaveURL(
    /\/_georeferencing\/core\/GeoreferencerController\//,
  );
  await expect(
    page
      .getByText("Authoritative editor store with revision-safe processing", {
        exact: false,
      })
      .first(),
  ).toBeVisible();
  await page.goto(`${base}_georeferencing/core/map/WfsReference/`);
  await expect(
    page.getByRole("heading", { name: "Interface WfsReference", exact: false }),
  ).toBeVisible();
  await expect(page.locator("#axisorder")).toBeAttached();
  for (const route of [
    "react/Georeferencer",
    "plugins/geotiff/geoTiff",
    "plugins/jpeg/jpeg",
    "plugins/pdf/pdf",
    "plugins/tiff/encodeGeoTiffBlob",
    "plugins/report/createPdfReport",
    "core/map/watchReferences",
    "openlayers/openLayers",
    "maplibre/maplibre",
    "leaflet/leaflet",
    "matching/createSnapshot",
    "matching/createWmsProvider",
    "matching/applyCandidate",
    "matching/browser/createBrowserMatcher",
    "matching/node/createNodeMatcher",
    "matching/openlayers/createOpenLayersProvider",
    "matching/leaflet/createLeafletProvider",
    "matching/maplibre/createMapLibreProvider",
  ]) {
    await page.goto(`${base}_georeferencing/${route}/`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      route.split("/").at(-1),
    );
  }
  await page.goto(`${base}Automatic_plan_matching/`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Automatic plan matching",
  );
  for (const example of [
    "matchInBrowser",
    "matchInNode",
    "acquirePlanReference",
    "prepareCandidateReview",
    "applyReviewedLocation",
  ])
    await expect(
      page.locator("pre").filter({ hasText: `function ${example}` }),
    ).toBeVisible();
  await expect(page.locator(".col-content")).toContainText(
    "It ships no UI components",
  );
  await page.locator("#tsd-search-trigger").click();
  await page.locator("#tsd-search-input").fill("ImageMatcher");
  const matchingResult = page
    .locator("#tsd-search-results a")
    .filter({ hasText: "ImageMatcher" })
    .first();
  await expect(matchingResult).toBeVisible();
  await matchingResult.click();
  await expect(page).toHaveURL(/\/_georeferencing\/matching\/ImageMatcher\//);
  await expect(page.locator("#match")).toBeAttached();
  assert.deepEqual(
    failures,
    [],
    "Documentation browser console/network failures",
  );
  const resultData = {
    pages: pages.length,
    localLinksAndAssets: linkCount,
    sourceLinks: sourceLinks.length,
    browser: browser.version(),
    deploymentBase: prefix,
    navigation: "passed",
    search: "passed",
    embeddedExample: "passed",
    matchingApiAndGuide: "passed",
  };
  await mkdir(join(root, "artifacts/reports"), { recursive: true });
  await writeFile(
    join(root, "artifacts/reports/documentation-validation.json"),
    `${JSON.stringify(resultData, null, 2)}\n`,
  );
  console.log(JSON.stringify(resultData, null, 2));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((accept) => server.close(accept));
}
