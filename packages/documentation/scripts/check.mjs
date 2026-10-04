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
        /\/blob\/main\/packages\/(core|plugins|react)\/src\//.test(link.href)
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
for (const name of ["core", "plugins", "react"]) {
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
  await expect(page).toHaveURL(/\/core\/GeoreferencerController\//);
  await expect(
    page
      .getByText("Authoritative editor store with revision-safe processing", {
        exact: false,
      })
      .first(),
  ).toBeVisible();
  await page.goto(`${base}openlayers/WfsReference/`);
  await expect(
    page.getByRole("heading", { name: "Interface WfsReference", exact: false }),
  ).toBeVisible();
  await expect(page.locator("#axisorder")).toBeAttached();
  for (const route of [
    "react/Georeferencer",
    "geotiff/geoTiff",
    "jpeg/jpeg",
    "pdf/pdf",
  ]) {
    await page.goto(`${base}${route}/`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      route.split("/")[1],
    );
  }
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
