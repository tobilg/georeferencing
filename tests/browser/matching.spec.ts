import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  corners,
  distance,
  transform,
} from "../../packages/matching/src/geometry.js";
import type { Matrix3 } from "../../packages/matching/src/types.js";
import type {} from "./harness/matching.js";
import { hasWebGL2, NO_WEBGL2 } from "./helpers.js";

test.use({ deviceScaleFactor: 2 });

test("EXIF normalization through the controller preserves final original-image coordinates", async ({
  page,
}) => {
  await page.goto("/matching.html");
  await page.waitForFunction(() => !!window.matching);
  const row = await page.evaluate(() => window.matching.oriented());
  expect(row.dimensions).toEqual([260, 250]);
  expect(row.result.status).toBe("matched");
  const actual = row.result.candidates[0].transform;
  const expected: Matrix3 = [0, 1, 130, -1, 0, 420, 0, 0, 1];
  for (const point of corners({ x: 0, y: 0, width: 260, height: 250 }))
    expect(
      distance(transform(actual, point), transform(expected, point)),
    ).toBeLessThan(1);
  await page.evaluate(() => window.matching.dispose());
});

test("matching runs off-thread, cancels and recovers", async ({ page }) => {
  await page.goto("/matching.html");
  await page.waitForFunction(() => !!window.matching);
  const { result, stages, ticks } = await page.evaluate(() =>
    window.matching.synthetic(),
  );
  expect(result.status).toBe("matched");
  expect(result.diagnostics.detector).toBe("sift");
  expect(result.candidates[0].extentStatus).toBe("complete");
  expect(ticks).toBeGreaterThan(1);
  expect(stages).toContain("extracting");
  expect(stages).toContain("validating");
  expect(await page.evaluate(() => window.matching.cancellation())).toBe(true);
  expect(
    await page.evaluate(() => window.matching.cancellation("initializing")),
  ).toBe(true);
  expect(
    (await page.evaluate(() => window.matching.synthetic())).result.status,
  ).toBe("matched");
  await page.evaluate(() => window.matching.dispose());
});
test("AKAZE matches in the shipped browser worker", async ({ page }) => {
  await page.goto("/matching.html");
  await page.waitForFunction(() => !!window.matching);
  const { result } = await page.evaluate(() =>
    window.matching.synthetic("akaze"),
  );
  expect(result.status).toBe("matched");
  expect(result.diagnostics.detector).toBe("akaze");
  const expected: Matrix3 = [1, 0, 130, 0, 1, 160, 0, 0, 1];
  for (const point of corners({ x: 0, y: 0, width: 250, height: 260 }))
    expect(
      distance(
        transform(result.candidates[0].transform, point),
        transform(expected, point),
      ),
    ).toBeLessThan(1);
  await page.evaluate(() => window.matching.dispose());
});
test("local PRD fixtures in shipped browser WASM", async ({
  page,
  browser,
}, info) => {
  test.skip(
    !existsSync("artifacts/matching/real-fixtures.json"),
    "Run node scripts/matching/export-fixtures.mjs with the private local plans to enable.",
  );
  test.setTimeout(180000);
  await page.goto("/matching.html");
  await page.waitForFunction(() => !!window.matching);
  const rows = await page.evaluate(
    (url) => window.matching.real(url),
    `/@fs/${resolve("artifacts/matching/real-fixtures.json")}`,
  );
  mkdirSync("artifacts/reports", { recursive: true });
  writeFileSync(
    `artifacts/reports/matching-${info.project.name}.json`,
    JSON.stringify(
      rows.map((row) => ({ ...row, runtime: browser.version() })),
      null,
      2,
    ),
  );
  for (const row of rows) {
    const label = `${row.detector} ${row.name}`;
    if (!row.expected) {
      expect(row.result.status, label).toBe("not-found");
      continue;
    }
    // A known miss may find nothing, but a placement it reports must still be accurate.
    if (row.mayMiss.includes(row.detector) && row.result.status === "not-found")
      continue;
    expect(row.result.status, label).toBe("matched");
    const c = row.result.candidates[0],
      points = corners({
        x: 0,
        y: 0,
        width: row.query[0],
        height: row.query[1],
      }),
      error =
        points.reduce(
          (sum, p) =>
            sum +
            distance(
              transform(c.transform, p),
              transform(row.expected as Matrix3, p),
            ),
          0,
        ) / 4;
    expect(error, label).toBeLessThan(row.name === "original" ? 1 : 2);
    if (row.expectedOverlap) {
      expect(c.extentStatus).toBe("partial");
      expect(Math.abs(c.overlapFraction - row.expectedOverlap)).toBeLessThan(
        0.02,
      );
    }
  }
  await page.evaluate(() => window.matching.dispose());
});

for (const layout of ["desktop", "mobile"] as const)
  test(`existing editor reviews and applies a match in the four-step workflow (${layout})`, async ({
    page,
  }) => {
    if (layout === "mobile")
      await page.setViewportSize({ width: 390, height: 844 });
    const wasmRequests: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes(".wasm")) wasmRequests.push(r.url());
    });
    await page.goto("http://127.0.0.1:5173");
    const steps = page.getByRole("list", { name: "Georeferencing steps" });
    await expect(steps.locator(".rg-step-label")).toHaveText([
      "Load image",
      "Match points",
      "Check alignment",
      "Export or draw",
    ]);
    await expect(
      page.getByRole("button", { name: "Load example image" }),
    ).not.toBeVisible();
    await page.getByText("Find points automatically", { exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Find location", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText("Load an image to enable automatic matching.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("spinbutton", { name: "Search West" }),
    ).not.toBeVisible();
    await page.getByRole("button", { name: "Load example image" }).click();
    await expect(
      page.getByRole("button", { name: "Find location", exact: true }),
    ).toBeEnabled();
    await expect(steps.locator('[aria-current="step"]')).toContainText(
      "Match points",
    );
    await page.getByText("Search settings", { exact: true }).click();
    await expect(
      page.getByRole("spinbutton", { name: "Search West" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.getByText("Search settings", { exact: true }).press("Enter");
    await expect(
      page.getByRole("spinbutton", { name: "Search West" }),
    ).not.toBeVisible();
    await page
      .getByRole("checkbox", { name: "Example plan", exact: true })
      .uncheck();
    await expect(
      page.getByRole("button", { name: "Find location", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText("Select at least one reference layer.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("checkbox", { name: "Example plan", exact: true })
      .check();
    expect(wasmRequests).toHaveLength(0);
    await page
      .getByRole("button", { name: "Find location", exact: true })
      .click();
    await expect(
      page.getByText("Match ready for review", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    expect(
      await page.evaluate(
        () => window.demo.controller.getSnapshot().document.gcps.length,
      ),
    ).toBe(0);
    await page.getByRole("button", { name: "Apply selected location" }).click();
    const points = await page.evaluate(
      () => window.demo.controller.getSnapshot().document.gcps,
    );
    expect(points.length).toBeGreaterThanOrEqual(6);
    expect(points.length).toBeLessThanOrEqual(16);
    expect(points[0].crs).toBe("EPSG:3857");
    await expect(steps.locator('[aria-current="step"]')).toContainText(
      "Match points",
    );
    await page
      .getByRole("button", { name: "Run alignment", exact: true })
      .click();
    await expect(steps.locator('[aria-current="step"]')).toContainText(
      "Check alignment",
    );
    await expect(
      page.getByText("Find points automatically", { exact: true }),
    ).not.toBeVisible();
    await page
      .getByRole("button", { name: "Adjust points", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Find location", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => window.demo.controller.undo());
    expect(
      await page.evaluate(
        () => window.demo.controller.getSnapshot().document.gcps.length,
      ),
    ).toBe(0);
  });

test("WMS acquisition runs through HTTP and preserves the snapshot", async ({
  page,
}) => {
  await page.goto("/matching.html");
  await page.waitForFunction(() => !!window.matching);
  const png = await page.evaluate(() => window.matching.referencePng());
  let requested: URL | undefined;
  await page.route("**/matching-wms?*", async (route) => {
    requested = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(png, "base64"),
    });
  });
  const result = await page.evaluate(() => window.matching.wms());
  expect(result.result.status).toBe("matched");
  expect(result.reference.extent).toEqual([0, 0, 640, 640]);
  expect(result.reference.source.parameters?.TIME).toBe("2026-10-08");
  expect(requested!.searchParams.get("CQL_FILTER")).toBe("status=1");
  expect(requested!.searchParams.get("LAYERS")).toBe("ivl");
  expect(requested!.searchParams.get("WIDTH")).toBe("640");
  await page.unroute("**/matching-wms?*");
  await page.route("**/matching-wms?*", (route) =>
    route.fulfill({ status: 403, body: "denied" }),
  );
  expect(
    await page.evaluate(() =>
      window.matching.wms().then(
        () => "unexpected",
        (error) => error.code,
      ),
    ),
  ).toBe("SOURCE");
});
for (const adapter of ["leaflet", "maplibre"] as const)
  test(`${adapter} WMS layer acquisition requests the exact area and matches`, async ({
    page,
  }) => {
    await page.goto("/matching.html");
    // The provider never renders, but creating the MapLibre map needs WebGL2. The
    // Node provider tests still cover it where the browser cannot create one.
    test.skip(adapter === "maplibre" && !(await hasWebGL2(page)), NO_WEBGL2);
    await page.waitForFunction(() => !!window.matching);
    const png = await page.evaluate(() => window.matching.referencePng());
    // The live map also loads its own tiles; only the provider's requests use
    // upper-case parameter names.
    const requested: URL[] = [];
    await page.route("**/matching-wms?*", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.has("REQUEST")) requested.push(url);
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(png, "base64"),
      });
    });
    const { view, reference, result } = await page.evaluate(
      (a) => window.matching.adapterWms(a),
      adapter,
    );
    expect(result.status).toBe("matched");
    expect(reference.extent).toEqual([0, 0, 640, 640]);
    expect(reference.source.parameters?.TIME).toBe("2026-10-08");
    // Zoom 12: Leaflet's world is 256 CSS pixels wide at zoom 0, MapLibre's 512.
    expect(view.crs).toBe("EPSG:3857");
    expect(view.resolution).toBeCloseTo(
      adapter === "leaflet" ? 38.2185 : 19.1093,
      3,
    );
    expect(requested).toHaveLength(1);
    const url = requested[0],
      keys = [...url.searchParams.keys()].map((k) => k.toUpperCase());
    expect(new Set(keys).size).toBe(keys.length);
    expect(url.searchParams.get("LAYERS")).toBe("ivl");
    expect(url.searchParams.get("STYLES")).toBe("engineering");
    expect(url.searchParams.get("WIDTH")).toBe("640");
    // Leaflet defaults to WMS 1.1.1 (SRS); the MapLibre template asks for 1.3.0 (CRS).
    expect(url.searchParams.get(adapter === "leaflet" ? "SRS" : "CRS")).toBe(
      "EPSG:3857",
    );
    if (adapter === "leaflet") {
      expect(url.searchParams.get("map")).toBe("plan");
      expect(url.searchParams.get("CQL_FILTER")).toBe("status=1");
    }
  });
