import { readFile } from "node:fs/promises";
import { expect, type Page, type Route, test } from "@playwright/test";
import { fromArrayBuffer } from "geotiff";
import type TileLayer from "ol/layer/Tile.js";
import type OSM from "ol/source/OSM.js";
import type {} from "../../packages/demo/main.js";

// The guided workflow exercises the real demo; other specs use the test harness.
test.use({
  baseURL: `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? 5173}`,
});

// Approximate quay/bridge landmarks; map coordinates are EPSG:3857 metres.
// These exercise the workflow, not numerical QGIS parity or surveyed accuracy.
const matches = [
  { image: [334, 327], reference: [1111125.061, 7083891.332] },
  { image: [705, 530], reference: [1111578.492, 7083627.177] },
  { image: [488, 107], reference: [1111321.844, 7084150.613] },
];
const osmTiles = "https://tile.openstreetmap.org/**";
// Automated navigation uses fixture pixels, never bulk-loads the public tile service.
test.beforeEach(async ({ page }) => {
  await page.route(osmTiles, (route) =>
    route.fulfill({
      path: "tests/fixtures/grid.png",
      contentType: "image/png",
      headers: { "Access-Control-Allow-Origin": "*" },
    }),
  );
});
async function imagePoint(page: Page, point: number[]) {
  const viewer = page.locator("svg.rg-image-view");
  await viewer.scrollIntoViewIfNeeded();
  const p = await viewer.evaluate((element, xy) => {
    const p = new DOMPoint(xy[0], xy[1]).matrixTransform(
      (element as SVGSVGElement).getScreenCTM()!,
    );
    return { x: p.x, y: p.y };
  }, point);
  await page.mouse.click(p.x, p.y);
}
async function mapPoint(page: Page, coordinate: number[]) {
  const target = page.getByRole("application", {
    name: "Reference map",
    exact: true,
  });
  await target.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => !window.demo.map.getView().getAnimating());
  const pixel = await page.evaluate((coordinate) => {
    const map = window.demo.map;
    let pixel = map.getPixelFromCoordinate(coordinate);
    const size = map.getSize()!;
    if (
      pixel[0] < 5 ||
      pixel[1] < 5 ||
      pixel[0] > size[0] - 5 ||
      pixel[1] > size[1] - 5
    ) {
      map.getView().setCenter(coordinate);
      map.renderSync();
      pixel = map.getPixelFromCoordinate(coordinate);
    }
    return pixel;
  }, coordinate);
  const box = (await target.boundingBox())!;
  await page.mouse.click(box.x + pixel[0], box.y + pixel[1]);
}
async function load(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the Hamburg example" }).click();
  await expect(page.locator(".rg-image-meta").first()).toHaveText(
    "elbphilharmonie.webp · 1240 × 697 px",
  );
  expect(
    await page.evaluate(() => window.demo.controller.getSnapshot().previewMode),
  ).toBe("manual");
  // The minimal guided setup hides expert controls.
  await expect(page.getByLabel("Preview updates")).toHaveCount(0);
  await expect(page.getByText("Enter coordinates manually")).toHaveCount(0);
}
async function pair(page: Page, index: number) {
  await imagePoint(page, matches[index].image);
  await expect(page.locator(".rg-instruction")).toContainText(
    "same spot on the map",
  );
  await mapPoint(page, matches[index].reference);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.demo.controller.getSnapshot().document.gcps.length,
      ),
    )
    .toBe(index + 1);
}

test("GCP-01/FIT-02: Hamburg manual matching → run → edit → rerun → export → draw and save", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let loads = 0;
  page.on("load", () => loads++);
  const tileResponse = page.waitForResponse(osmTiles);
  await load(page);
  expect((await tileResponse).ok()).toBe(true);
  expect(
    await page.evaluate(() => {
      const layer = window.demo.map.getLayers().item(0) as TileLayer<OSM>;
      return {
        visible: layer.getVisible(),
        urls: layer.getSource()!.getUrls(),
        collapsible: layer.getSource()!.getAttributionsCollapsible(),
      };
    }),
  ).toEqual({
    visible: true,
    urls: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    collapsible: false,
  });
  await expect(
    page.locator(
      '.ol-attribution a[href="https://www.openstreetmap.org/copyright"]',
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => window.demo.controller.getSnapshot().document.gcps,
    ),
  ).toHaveLength(0);
  await expect(
    page.getByRole("button", { name: "Run alignment", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Looks good, continue", exact: true }),
  ).toHaveCount(0);
  for (let i = 0; i < 3; i++) await pair(page, i);
  expect(
    await page.evaluate(() => ({
      fit: window.demo.controller.getSnapshot().fit,
      fitting: window.demo.controller.getSnapshot().fitting,
      error: window.demo.controller.getSnapshot().error,
    })),
  ).toEqual({ fit: null, fitting: "idle", error: null });
  await page
    .getByRole("button", { name: "Run alignment", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Looks good, continue" }),
  ).toBeEnabled();
  await expect(page.locator(".rg-instruction")).toContainText(
    "Does the image line up with the map?",
  );
  await expect(page.locator(".rg-accuracy")).toContainText(
    "Accuracy not measured yet",
  );
  await page
    .getByRole("button", { name: "Adjust points", exact: true })
    .click();
  await page.evaluate(() => {
    const c = window.demo.controller;
    const [first] = c.getSnapshot().document.gcps;
    c.updateGcp(first.id, {
      target: [first.target[0] + 1, first.target[1]],
    });
  });
  expect(
    await page.evaluate(() => window.demo.controller.getSnapshot().fit),
  ).toBeNull();
  await page
    .getByRole("button", { name: "Run alignment", exact: true })
    .click();
  await page.getByRole("button", { name: "Looks good, continue" }).click();
  await expect(page.locator(".rg-instruction")).toContainText(
    "Download the result or draw on the map",
  );
  const download = page.waitForEvent("download");
  await page.locator('[data-export-format="geotiff"]').click();
  const file = await download;
  const data = await readFile((await file.path())!);
  const tiff = await fromArrayBuffer(
    data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer,
  );
  const raster = await tiff.getImage();
  expect(raster.getGeoKeys()?.ProjectedCSTypeGeoKey).toBe(3857);
  expect(raster.getBoundingBox()[0]).toBeGreaterThan(1_100_000);
  expect(raster.getWidth()).toBeGreaterThan(100);
  // The first PDF export lazily loads pdf-lib. A cold dev server must not reload the
  // page for it, which would discard the whole editor session.
  const report = page.waitForEvent("download");
  await page.locator('[data-export-format="pdf"]').click();
  expect((await report).suggestedFilename()).toBe("alignment-map-report.pdf");
  expect(loads).toBe(1);
  expect(
    await page.evaluate(
      () => window.demo.controller.getSnapshot().document.gcps.length,
    ),
  ).toBe(3);
  await page.getByRole("button", { name: "Point", exact: true }).click();
  await mapPoint(page, [1111490.328, 7083748.046]);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.demo.controller.getSnapshot().document.features.features
            .length,
      ),
    )
    .toBe(1);
  await page.getByRole("button", { name: "Line", exact: true }).click();
  await mapPoint(page, [1111509.809, 7083748.046]);
  await mapPoint(page, [1111558.511, 7083748.046]);
  await page
    .getByRole("button", { name: "Finish drawing", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.demo.controller.getSnapshot().document.features.features
            .length,
      ),
    )
    .toBe(2);
  await page.getByRole("button", { name: "Area", exact: true }).click();
  await mapPoint(page, [1111587.733, 7083748.046]);
  await mapPoint(page, [1111646.175, 7083748.046]);
  await mapPoint(page, [1111616.954, 7083699.309]);
  await page
    .getByRole("button", { name: "Finish drawing", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.demo.controller
          .getSnapshot()
          .document.features.features.map((f) => f.geometry.type),
      ),
    )
    .toEqual(["Point", "LineString", "Polygon"]);
  await page
    .getByRole("button", { name: "Save features", exact: true })
    .click();
  await expect(
    page.getByText("Features saved.", { exact: true }),
  ).toBeVisible();
  const geometry = await page.evaluate(
    () =>
      window.demo.controller.getSnapshot().document.features.features[0]
        .geometry,
  );
  expect(geometry.type).toBe("Point");
  if (geometry.type === "Point") {
    expect(geometry.coordinates[0]).toBeGreaterThan(9.9);
    expect(geometry.coordinates[1]).toBeGreaterThan(53.5);
  }
  expect(errors).toEqual([]);
});

test("FIT-02/IMG-06: automatic preview is explicit; pending cancellation and replacement preserve the map", async ({
  page,
}) => {
  await load(page);
  await page.evaluate(() => window.demo.controller.setPreviewMode("automatic"));
  await imagePoint(page, [220, 220]);
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(
      () => window.demo.controller.getSnapshot().pendingImagePoint,
    ),
  ).toBeNull();
  expect(
    await page.evaluate(() => window.demo.controller.getSnapshot().tool),
  ).toBe("gcp");
  for (let i = 0; i < 3; i++) await pair(page, i);
  await expect
    .poll(() =>
      page.evaluate(() => window.demo.controller.getSnapshot().fitting),
    )
    .toBe("succeeded");
  await expect(
    page.getByRole("button", { name: "Review alignment", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".rg-instruction")).toContainText(
    "Click a recognizable spot in the image",
  );
  const before = await page.evaluate(() =>
    window.demo.map.getView().getCenter(),
  );
  await page.getByRole("button", { name: "Remove image", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    await page.evaluate(
      () => window.demo.controller.getSnapshot().document.gcps.length,
    ),
  ).toBe(3);
  await page.getByRole("button", { name: "Remove image", exact: true }).click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.demo.controller.getSnapshot().document.gcps.length,
      ),
    )
    .toBe(0);
  expect(
    await page.evaluate(() => window.demo.map.getView().getCenter()),
  ).toEqual(before);
  expect(
    await page.evaluate(() => window.demo.controller.getSnapshot().error),
  ).toBeNull();
});

test("NFR-06: laptop keeps both views visible; narrow tabs follow incomplete pairs", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await load(page);
  const source = await page.locator(".rg-image-view").boundingBox();
  const map = await page.locator(".workshop-map").boundingBox();
  expect(source!.x + source!.width).toBeLessThan(map!.x);
  expect(Math.abs(source!.y - map!.y)).toBeLessThan(2);
  expect(source!.y + source!.height).toBeLessThan(768);
  const zoomIn = await page.locator(".ol-zoom-in").boundingBox();
  const zoomOut = await page.locator(".ol-zoom-out").boundingBox();
  expect(zoomIn!.y + zoomIn!.height).toBeLessThanOrEqual(zoomOut!.y);
  expect(
    await page
      .locator(".ol-zoom-in")
      .evaluate((element) => getComputedStyle(element).padding),
  ).toBe("0px");
  const resolution = await page.evaluate(
    () => window.demo.map.getView().getResolution()!,
  );
  await page.locator(".ol-zoom-in").click();
  await expect
    .poll(() => page.evaluate(() => window.demo.map.getView().getResolution()!))
    .toBeLessThan(resolution);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    1024,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".rg-source-pane")).toBeVisible();
  await expect(page.locator(".rg-reference-pane")).toBeHidden();
  await imagePoint(page, matches[0].image);
  await expect(page.locator(".rg-reference-pane")).toBeVisible();
  await expect(page.locator(".rg-source-pane")).toBeHidden();
  await mapPoint(page, matches[0].reference);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.demo.controller.getSnapshot().document.gcps.length,
      ),
    )
    .toBe(1);
  await expect(page.locator(".rg-source-pane")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
});

test("REF-01/NFR-09: unavailable OSM tiles allow coordinate selection and retry", async ({
  page,
}) => {
  const failTiles = (route: Route) => route.abort();
  await page.route(osmTiles, failTiles);
  await load(page);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Some OpenStreetMap tiles could not load." }),
  ).toBeVisible();
  await pair(page, 0);
  const before = await page.evaluate(() => ({
    gcps: window.demo.controller.getSnapshot().document.gcps,
    center: window.demo.map.getView().getCenter(),
  }));
  await page.unroute(osmTiles, failTiles);
  const recovered = page.waitForResponse(osmTiles);
  await page.getByRole("button", { name: "Retry map tiles" }).click();
  expect((await recovered).ok()).toBe(true);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Some OpenStreetMap tiles could not load." }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => ({
      gcps: window.demo.controller.getSnapshot().document.gcps,
      center: window.demo.map.getView().getCenter(),
    })),
  ).toEqual(before);
});

test("NAV-01: both views pan by dragging and zoom by wheel without page scroll", async ({
  page,
}) => {
  await load(page);
  const state = () =>
    page.evaluate(() => {
      const s = window.demo.controller.getSnapshot();
      const view = window.demo.map.getView();
      return {
        imageView: s.imageView!,
        pending: s.pendingImagePoint,
        center: view.getCenter()!,
        resolution: view.getResolution()!,
        scrollY: window.scrollY,
      };
    });
  const drag = async (box: { x: number; y: number }) => {
    await page.mouse.move(box.x + 150, box.y + 150);
    await page.mouse.down();
    await page.mouse.move(box.x + 210, box.y + 190, { steps: 6 });
    await page.mouse.up();
  };
  const image = (await page.locator("svg.rg-image-view").boundingBox())!;
  const before = await state();
  await page.mouse.move(image.x + image.width / 2, image.y + image.height / 2);
  await page.mouse.wheel(0, -300);
  await expect
    .poll(async () => (await state()).imageView[2])
    .toBeLessThan(before.imageView[2]);
  const zoomed = await state();
  await drag(image);
  const panned = await state();
  expect(panned.imageView[0]).toBeLessThan(zoomed.imageView[0]);
  expect(panned.pending).toBeNull();
  expect(panned.scrollY).toBe(before.scrollY);

  const map = (await page.locator(".workshop-map").boundingBox())!;
  await page.mouse.move(map.x + map.width / 2, map.y + map.height / 2);
  await page.mouse.wheel(0, -300);
  await expect
    .poll(async () => (await state()).resolution)
    .toBeLessThan(before.resolution);
  await page.waitForFunction(() => !window.demo.map.getView().getAnimating());
  const mapZoomed = await state();
  await drag(map);
  await expect
    .poll(async () => (await state()).center[0])
    .toBeLessThan(mapZoomed.center[0]);
  expect((await state()).scrollY).toBe(before.scrollY);
});
test("NAV-02: zooming beyond the preview resolution shows the full-resolution image", async ({
  page,
}) => {
  await load(page);
  const detail = page.locator("svg.rg-image-view image[data-detail]");
  const detailUrl = () =>
    page.evaluate(() => window.demo.controller.getSnapshot().detailImageUrl);
  await expect(detail).toHaveCount(0);
  expect(await detailUrl()).toBeNull();
  const image = (await page.locator("svg.rg-image-view").boundingBox())!;
  await page.mouse.move(image.x + image.width / 2, image.y + image.height / 2);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -300);
  await expect(detail).toHaveCount(1);
  expect(await detailUrl()).toMatch(/^blob:/);
  // The 1240 px WebP is unrotated: it is displayed directly, without a worker job.
  const size = await detail.evaluate(
    (element) =>
      new Promise<number[]>((resolve) => {
        const img = new Image();
        img.onload = () => resolve([img.naturalWidth, img.naturalHeight]);
        img.src = element.getAttribute("href")!;
      }),
  );
  expect(size).toEqual([1240, 697]);
  await page.getByRole("button", { name: "Fit image" }).click();
  await expect(detail).toHaveCount(0);
});
