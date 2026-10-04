import { expect, test } from "@playwright/test";
import { loadSynthetic } from "./helpers.js";

test("PKG-01 optional formats can be disabled without blocking alignment and saving", async ({
  page,
}) => {
  await loadSynthetic(page);
  await page.waitForFunction(() =>
    Boolean(window.validation.editors[0].controller.getSnapshot().fit),
  );
  await page.evaluate(() =>
    window.validation.editors[0].controller.setExportFormats([]),
  );
  await expect(page.locator("[data-export-format]")).toHaveCount(0);
  const result = await page.evaluate(async () => {
    const c = window.validation.editors[0].controller;
    c.confirm();
    c.setFeatures({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "no-plugins",
          properties: { name: "No raster export" },
          geometry: { type: "Point", coordinates: [0.01, 0.02] },
        },
      ],
    });
    await c.save();
    return { saving: c.getSnapshot().saving, dirty: c.getSnapshot().dirty };
  });
  expect(result).toEqual({ saving: "succeeded", dirty: false });
});

test("OUT-01 JPEG worker exports independently readable pixels and georeferencing sidecars", async ({
  page,
}) => {
  await loadSynthetic(page);
  await page.waitForFunction(() =>
    Boolean(window.validation.editors[0].controller.getSnapshot().fit),
  );
  const result = await page.evaluate(async () => {
    const c = window.validation.editors[0].controller;
    c.setExportFormats(
      c.getSnapshot().exportFormats.filter((x) => x.id === "jpeg"),
    );
    c.setOutput({
      ...c.getSnapshot().document.output,
      bounds: [900, 1600, 1300, 2100],
      resolution: [2, 2],
    });
    const exported = await c.export("jpeg");
    if (!exported?.raster)
      throw Error(c.getSnapshot().error ?? "Missing JPEG export");
    const bitmap = await createImageBitmap(exported.blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
      ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const data = exported.raster.data;
    let error = 0,
      samples = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] !== 255) continue;
      for (let channel = 0; channel < 3; channel++) {
        error += Math.abs(data[i + channel] - pixels[i + channel]);
        samples++;
      }
    }
    const world = (await exported.files[1].blob.text())
      .trim()
      .split("\n")
      .map(Number);
    return {
      type: exported.blob.type,
      signature: Array.from(
        new Uint8Array(await exported.blob.slice(0, 2).arrayBuffer()),
      ),
      width: canvas.width,
      height: canvas.height,
      corner: Array.from(pixels.slice(0, 4)),
      meanError: error / samples,
      world,
      metadata: JSON.parse(await exported.files[2].blob.text()),
      format: exported.format,
      previewIntact: c.getSnapshot().preview!.data.byteLength > 0,
    };
  });
  expect(result.type).toBe("image/jpeg");
  expect(result.signature).toEqual([255, 216]);
  expect([result.width, result.height]).toEqual([200, 250]);
  expect(result.world).toEqual([2, 0, 0, -2, 901, 2099]);
  expect(result.metadata).toMatchObject({
    crs: "EPSG:3857",
    bounds: [900, 1600, 1300, 2100],
    width: 200,
    height: 250,
    format: "jpeg",
    quality: 0.92,
    background: [255, 255, 255],
  });
  expect(result.corner).toEqual([255, 255, 255, 255]);
  expect(result.meanError).toBeLessThan(15);
  expect(result.previewIntact).toBe(true);
  expect(result.format).toBe("jpeg");
  await expect(page.locator("[data-export-format]")).toHaveCount(1);
  await expect(page.locator('[data-export-format="jpeg"]')).toHaveText(
    "Export JPEG",
  );
});
