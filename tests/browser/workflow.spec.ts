import { expect, test } from "@playwright/test";
import { loadSynthetic } from "./helpers.js";

test("OUT-05 output controls track document updates and undo", async ({
  page,
}) => {
  await loadSynthetic(page);
  await expect(
    page.getByRole("button", { name: "Confirm alignment and draw" }),
  ).toBeEnabled();
  await page
    .getByText("Raster output & session files", { exact: true })
    .click();
  const size = page.getByLabel("Pixel size", { exact: true });
  await size.fill("2,3");
  await size.press("Enter");
  expect(
    await page.evaluate(
      () =>
        window.validation.editors[0].controller.getSnapshot().document.output
          .resolution,
    ),
  ).toEqual([2, 3]);
  await page
    .getByRole("combobox", { name: "TIFF compression", exact: true })
    .selectOption("deflate");
  await page.evaluate(() => window.validation.editors[0].controller.undo());
  await expect(
    page.getByRole("combobox", { name: "TIFF compression", exact: true }),
  ).toHaveValue("none");
  await expect(size).toHaveValue("2,3");
  await page.evaluate(() => window.validation.editors[0].controller.undo());
  await expect(size).toHaveValue("");
  await page.evaluate(() =>
    window.validation.editors[0].controller.setOutput({
      crs: "EPSG:3857",
      resampler: "nearest",
      bounds: [1000, 1700, 1200, 2000],
      resolution: [4, 5],
    }),
  );
  await expect(size).toHaveValue("4,5");
  await expect(page.getByLabel("Output bounds", { exact: true })).toHaveValue(
    "1000,1700,1200,2000",
  );
});
test("AC-01–20: image → affine → confirm → mixed drawings → host save; review and lifecycle", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loadSynthetic(page, true);
  await expect(
    page.getByRole("button", { name: "Confirm alignment and draw" }),
  ).toBeEnabled();
  await expect(page.getByText("grid.png · 100 × 100 px")).toBeVisible();
  const initial = await page.evaluate(() => ({
    layers: window.validation.editors[0].map.getLayers().getLength(),
    interactions: window.validation.editors[0].map
      .getInteractions()
      .getLength(),
    hostCount: window.validation.editors[0].host.getSource()!.getFeatures()
      .length,
  }));
  expect(initial.layers).toBe(6);
  await page.getByRole("button", { name: "Fit map to image" }).click();
  await page
    .getByRole("button", { name: "Confirm alignment and draw" })
    .click();
  await expect(page.getByLabel("Image X 1", { exact: true })).toBeDisabled();
  const map = page.getByLabel("Map 1", { exact: true });
  const box = (await map.boundingBox())!;
  const click = (x: number, y: number) =>
    page.mouse.click(box.x + x, box.y + y);
  await page.getByRole("button", { name: "Point", exact: true }).click();
  await click(220, 220);
  await click(280, 260);
  await page.getByRole("button", { name: "LineString", exact: true }).click();
  await click(180, 200);
  await click(220, 300);
  await page.mouse.dblclick(box.x + 300, box.y + 280);
  await page.getByRole("button", { name: "Polygon", exact: true }).click();
  await click(320, 200);
  await click(430, 200);
  await click(400, 320);
  await click(320, 200);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.validation.editors[0].controller.getSnapshot().document
            .features.features.length,
      ),
    )
    .toBe(4);
  await page.getByRole("button", { name: "Pan map", exact: true }).click();
  await page.evaluate(() => window.validation.editors[0].setSaveFailure(true));
  await page
    .getByRole("button", { name: "Save features", exact: true })
    .click();
  await expect(
    page.getByText("Save failed. Draft retained; retry when ready."),
  ).toBeVisible();
  await page.evaluate(() => window.validation.editors[0].setSaveFailure(false));
  await page
    .getByRole("button", { name: "Save features", exact: true })
    .click();
  await expect(page.getByText("Saved by host.", { exact: true })).toBeVisible();
  const original = await page.evaluate(
    () =>
      window.validation.editors[0].controller.getSnapshot().document.features,
  );
  expect(original.features.map((f) => f.geometry.type).sort()).toEqual([
    "LineString",
    "Point",
    "Point",
    "Polygon",
  ]);
  expect(
    (original.features[0].geometry as { coordinates: number[] }).coordinates[0],
  ).toBeLessThan(1);
  await page
    .getByRole("button", { name: "Return to alignment", exact: true })
    .click();
  await page.getByLabel("Target X 1", { exact: true }).fill("1001");
  await page.getByLabel("Target X 1", { exact: true }).press("Tab");
  await expect(
    page.getByRole("button", { name: "Confirm alignment and draw" }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () =>
        window.validation.editors[0].controller.getSnapshot().document.features,
    ),
  ).toEqual(original);
  await page
    .getByRole("button", { name: "Confirm alignment and draw" })
    .click();
  await expect(
    page.getByRole("button", { name: "Save features", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "I reviewed drawings against this alignment" })
    .click();
  await expect(
    page.getByRole("button", { name: "Save features", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Remove image", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("grid.png · 100 × 100 px")).toBeVisible();
  await page.evaluate(() => window.validation.editors[0].detach());
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.validation.editors[0].map.getLayers().getLength(),
      ),
    )
    .toBe(1);
  expect(
    await page.evaluate(() =>
      window.validation.editors[0].map.getInteractions().getLength(),
    ),
  ).toBe(initial.interactions);
  expect(
    await page.evaluate(
      () => window.validation.editors[0].host.getSource()!.getFeatures().length,
    ),
  ).toBe(initial.hostCount);
  await page.evaluate(() => window.validation.editors[0].attach());
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.validation.editors[0].map.getLayers().getLength(),
      ),
    )
    .toBe(6);
  const view = await page.evaluate(() =>
    window.validation.editors[0].map.getView().getCenter(),
  );
  await page.getByRole("button", { name: "Remove image", exact: true }).click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(
    page.getByText("Drop a map, plan, or photograph here."),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.validation.editors[0].map.getView().getCenter(),
    ),
  ).toEqual(view);
  expect(
    await page.evaluate(
      () =>
        window.validation.editors[0].controller.getSnapshot().document.features
          .features.length,
    ),
  ).toBe(0);
  expect(errors).toEqual([]);
});
test("AC-03/05/09: canonical image picking, numeric endpoints, undo, WFS snap snapshot", async ({
  page,
}) => {
  await loadSynthetic(page, true);
  await expect(
    page.getByRole("button", { name: "Confirm alignment and draw" }),
  ).toBeEnabled();
  await page.getByLabel("Enable point 4", { exact: true }).uncheck();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.validation.editors[0].controller.getSnapshot().fit?.residuals
            .length,
      ),
    )
    .toBe(3);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByLabel("Enable point 4", { exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(
    page.getByLabel("Enable point 4", { exact: true }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Add / move points" }).click();
  // Native pointer events quantize to CSS pixels. Use a scale where one CSS pixel
  // is less than 0.18 source pixels, so the quarter-source-pixel gate is measurable.
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: "Zoom image in" }).click();
  const svg = page.locator(".rg-image-view");
  await svg.scrollIntoViewIfNeeded();
  const b = (await svg.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  const first = await page.evaluate(
    () =>
      window.validation.editors[0].controller.getSnapshot().pendingImagePoint,
  );
  expect(Math.hypot(first![0] - 50, first![1] - 50)).toBeLessThan(0.25);
  await page.getByRole("button", { name: "Zoom image in" }).click();
  await svg.scrollIntoViewIfNeeded();
  const zoomed = (await svg.boundingBox())!;
  await page.mouse.click(
    zoomed.x + zoomed.width / 2,
    zoomed.y + zoomed.height / 2,
  );
  const second = await page.evaluate(
    () =>
      window.validation.editors[0].controller.getSnapshot().pendingImagePoint,
  );
  // Physical pointer positions are rounded to CSS pixels by Firefox/WebKit.
  // At this scale 0.25 original pixel is less than one CSS pixel.
  expect(
    Math.hypot(second![0] - first![0], second![1] - first![1]),
  ).toBeLessThan(0.25);
  const target = await page.evaluate(() =>
    window.validation.editors[0].map.getPixelFromCoordinate([1000, 2000]),
  );
  const box = (await page.getByLabel("Map 1", { exact: true }).boundingBox())!;
  await page.mouse.click(box.x + target[0] + 2, box.y + target[1] + 2);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.validation.editors[0].controller.getSnapshot().document.gcps
            .length,
      ),
    )
    .toBe(5);
  const p = await page.evaluate(
    () =>
      window.validation.editors[0].controller
        .getSnapshot()
        .document.gcps.at(-1)!,
  );
  expect(p.target).toEqual([1000, 2000]);
  expect(p.reference).toBeDefined();
  await page.evaluate(() =>
    window.validation.editors[0].map.getView().setCenter([3000, 3000]),
  );
  await page.waitForTimeout(300);
  expect(
    await page.evaluate(
      () =>
        window.validation.editors[0].controller
          .getSnapshot()
          .document.gcps.at(-1)!.target,
    ),
  ).toEqual(p.target);
});
test("AC-18/28: standalone image processing and export cancellation recovers", async ({
  page,
}) => {
  await loadSynthetic(page);
  await expect(
    page.getByRole("button", { name: "Confirm alignment and draw" }),
  ).toBeEnabled();
  await page.evaluate(() => {
    window.validation.editors[0].controller.options.digitizing = false;
  });
  await page
    .getByText("Raster output & session files", { exact: true })
    .click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export GeoTIFF", exact: true })
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toContain(".tif");
  const result = await page.evaluate(async () => {
    const c = window.validation.editors[0].controller;
    const promise = c.exportRaster();
    c.cancelExport();
    const first = await promise;
    const second = await c.exportRaster();
    return {
      cancelled: first === null,
      recovered: second!.blob.size > 100,
      state: c.getSnapshot().exporting,
    };
  });
  expect(result).toEqual({
    cancelled: true,
    recovered: true,
    state: "succeeded",
  });
});
