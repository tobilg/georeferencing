import { expect, type Page, test } from "@playwright/test";
import type {} from "./harness/adapters.js";

const R = 6378137;
const mercator = ([lon, lat]: number[]) => [
  (R * lon * Math.PI) / 180,
  R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
];

async function open(page: Page, lib: string) {
  await page.goto(`/adapters.html?lib=${lib}`);
  await page.waitForFunction(() => window.adapters?.owned().layers > 0);
  expect(await page.evaluate(() => window.adapters.loadGrid())).toBe(true);
}
async function clickAt(page: Page, lonLat: number[], offset = [0, 0]) {
  const p = await page.evaluate(
    (c) => window.adapters.toPage(c as [number, number]),
    lonLat,
  );
  await page.mouse.click(p.x + offset[0], p.y + offset[1]);
}
const snapshot = (page: Page) =>
  page.evaluate(() => {
    const s = window.adapters.controller.getSnapshot();
    return {
      gcps: s.document.gcps,
      features: s.document.features.features,
      preview: s.preview && { crs: s.preview.crs, bounds: s.preview.bounds },
      references: s.references,
      error: s.error,
    };
  });

for (const lib of ["maplibre", "leaflet"]) {
  test.describe(`${lib} adapter`, () => {
    test("picks and snaps control points, shows the preview and cleans up", async ({
      page,
    }) => {
      await open(page, lib);
      await expect
        .poll(async () => (await snapshot(page)).references.landmarks?.state)
        .toBe("ready");
      await page.evaluate(() => {
        const c = window.adapters.controller;
        c.setTool("gcp");
        c.setPendingPoint([10, 10]);
      });
      await clickAt(page, [0.01, 0.016]);
      await expect.poll(async () => (await snapshot(page)).gcps.length).toBe(1);
      const free = (await snapshot(page)).gcps[0];
      const expected = mercator([0.01, 0.016]);
      expect(free.crs).toBe("EPSG:3857");
      // Within two screen pixels (about 2.4 m at zoom 17).
      expect(Math.abs(free.target[0] - expected[0])).toBeLessThan(2.5);
      expect(Math.abs(free.target[1] - expected[1])).toBeLessThan(2.5);
      expect(free.reference).toBeUndefined();
      // A click 5 px from the reference point snaps to it, with provenance.
      await page.evaluate(() =>
        window.adapters.controller.setPendingPoint([20, 20]),
      );
      await clickAt(page, [0.0098, 0.0172], [5, -3]);
      await expect.poll(async () => (await snapshot(page)).gcps.length).toBe(2);
      const snapped = (await snapshot(page)).gcps[1];
      expect(snapped.reference).toEqual({
        sourceId: "landmarks",
        featureId: "tower",
      });
      const tower = mercator([0.0098, 0.0172]);
      expect(snapped.target[0]).toBeCloseTo(tower[0], 3);
      expect(snapped.target[1]).toBeCloseTo(tower[1], 3);
      expect(await page.evaluate(() => window.adapters.owned().markers)).toBe(
        2,
      );

      // The preview is rendered in Web Mercator and displayed.
      await page.evaluate(() => {
        const c = window.adapters.controller;
        c.replaceGcps(window.adapters.fixture("polynomial1"));
      });
      await expect
        .poll(async () => (await snapshot(page)).preview?.crs)
        .toBe("EPSG:3857");
      await expect
        .poll(() => page.evaluate(() => window.adapters.previewShown()))
        .toBe(true);
      const count = (await snapshot(page)).gcps.length;
      // Every marker is drawn at its control point, not shifted by earlier markers.
      const markerErrors = await page.evaluate(() =>
        window.adapters.markerErrors(),
      );
      expect(markerErrors).toHaveLength(count);
      expect(Math.max(...markerErrors)).toBeLessThan(2);
      expect(await page.evaluate(() => window.adapters.owned().markers)).toBe(
        count,
      );
      await page.evaluate(() =>
        window.adapters.controller.setDisplay({ visible: false }),
      );
      await expect
        .poll(() => page.evaluate(() => window.adapters.previewShown()))
        .toBe(false);

      // Unmounting the editor removes every owned layer, marker and status.
      await page.evaluate(() => window.adapters.setMounted(false));
      await expect
        .poll(() => page.evaluate(() => window.adapters.owned()))
        .toEqual({ layers: 0, markers: 0 });
      expect((await snapshot(page)).references.landmarks).toBeUndefined();
      expect((await snapshot(page)).error).toBeNull();
    });

    test("draws, finishes and edits features with Terra Draw", async ({
      page,
    }) => {
      await open(page, lib);
      await page.evaluate(() => {
        const c = window.adapters.controller;
        c.replaceGcps(window.adapters.fixture("polynomial1"));
      });
      await expect
        .poll(async () => (await snapshot(page)).preview?.crs)
        .toBe("EPSG:3857");
      await page.evaluate(() => {
        const c = window.adapters.controller;
        c.confirm();
        c.setTool("Point");
      });
      // Terra Draw loads on first use; retry the click until the point lands.
      await expect
        .poll(async () => {
          await clickAt(page, [0.0102, 0.0168]);
          return (await snapshot(page)).features.length;
        })
        .toBeGreaterThan(0);
      const point = (await snapshot(page)).features[0];
      expect(point.geometry.type).toBe("Point");
      const [lon, lat] = (point.geometry as { coordinates: number[] })
        .coordinates;
      expect(lon).toBeCloseTo(0.0102, 4);
      expect(lat).toBeCloseTo(0.0168, 4);
      const pointCount = (await snapshot(page)).features.length;

      await page.evaluate(() => window.adapters.controller.setTool("Polygon"));
      for (const corner of [
        [0.0099, 0.0163],
        [0.0103, 0.0163],
        [0.0103, 0.0166],
      ]) {
        await clickAt(page, corner);
        await page.waitForTimeout(150);
      }
      await page
        .getByRole("button", { name: "Finish drawing" })
        .first()
        .click();
      await expect
        .poll(async () => (await snapshot(page)).features.length)
        .toBe(pointCount + 1);
      const polygon = (await snapshot(page)).features.at(-1)!;
      expect(polygon.geometry.type).toBe("Polygon");
      expect(
        (polygon.geometry as { coordinates: number[][][] }).coordinates[0],
      ).toHaveLength(4);

      // Modify loads drafts into Terra Draw and hides the adapter's own draft layer.
      await page.evaluate(() => window.adapters.controller.setTool("modify"));
      await expect
        .poll(() => page.evaluate(() => window.adapters.draftsShown()))
        .toBe(false);
      await page.evaluate(() => window.adapters.controller.setTool("navigate"));
      await expect
        .poll(() => page.evaluate(() => window.adapters.draftsShown()))
        .toBe(true);
      expect((await snapshot(page)).features).toHaveLength(pointCount + 1);
      expect((await snapshot(page)).error).toBeNull();
    });

    if (lib === "maplibre")
      test("restores owned layers after the host replaces the style", async ({
        page,
      }) => {
        await open(page, lib);
        const before = await page.evaluate(
          () => window.adapters.owned().layers,
        );
        await page.evaluate(() => window.adapters.replaceStyle());
        await expect
          .poll(() => page.evaluate(() => window.adapters.owned().layers))
          .toBe(before);
      });
  });
}
