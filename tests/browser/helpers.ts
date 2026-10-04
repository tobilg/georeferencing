import type { Page } from "@playwright/test";
import type {} from "./harness/validation.js";

/** One editor from the shared validation harness; no public demo shortcuts required. */
export async function openValidation(page: Page) {
  await page.goto("/validation.html?editors=1");
  await page.waitForFunction(() => Boolean(window.validation?.editors[0]?.map));
}

/** Deterministic source, affine pairs and optional bounded/paged WFS + borrowed layer. */
export async function loadSynthetic(page: Page, references = false) {
  await openValidation(page);
  if (references) {
    await page.evaluate(() => {
      const { host, setReferences } = window.validation.editors[0];
      const features = window.validation
        .fixture("polynomial1")
        .slice(0, 4)
        .map((point) => ({
          type: "Feature",
          id: `reference-${point.id}`,
          geometry: { type: "Point", coordinates: point.target },
          properties: { label: point.label },
        }));
      setReferences([
        {
          id: "borrowed",
          label: "Host layer",
          kind: "existing-vector",
          layer: host,
          snapping: { vertices: true },
        },
        {
          id: "fixture-wfs",
          label: "Synthetic WFS",
          kind: "wfs",
          url: "/fixture-wfs",
          version: "2.0.0",
          typeNames: ["test:landmarks"],
          requestCrs: "EPSG:3857",
          responseCrs: "EPSG:3857",
          axisOrder: "xy",
          responseFormat: "geojson",
          pageSize: 2,
          queryBounds: { extent: [800, 1550, 1400, 2150], crs: "EPSG:3857" },
          snapping: { vertices: true, tolerancePx: 12 },
          request: async (url, init) => {
            init.signal?.throwIfAborted();
            const params = new URL(url).searchParams;
            const bbox = params.get("bbox")!.split(",").slice(0, 4).map(Number);
            const start = Number(params.get("startIndex"));
            const matching = features.filter(
              ({
                geometry: {
                  coordinates: [x, y],
                },
              }) =>
                x >= bbox[0] && y >= bbox[1] && x <= bbox[2] && y <= bbox[3],
            );
            return new Response(
              JSON.stringify({
                type: "FeatureCollection",
                numberMatched: matching.length,
                features: matching.slice(start, start + 2),
              }),
              { headers: { "content-type": "application/json" } },
            );
          },
        },
      ]);
    });
    await page.waitForFunction(
      () =>
        window.validation.editors[0].controller.getSnapshot().references[
          "fixture-wfs"
        ]?.state === "ready",
    );
  }
  await page
    .getByLabel("Choose image", { exact: true })
    .setInputFiles("tests/fixtures/grid.png");
  await page.waitForFunction(() =>
    Boolean(window.validation.editors[0].controller.getSnapshot().imageUrl),
  );
  await page.evaluate(() =>
    window.validation.editors[0].controller.replaceGcps(
      window.validation.fixture("polynomial1").slice(0, 4),
    ),
  );
  await page.waitForFunction(() =>
    Boolean(window.validation.editors[0].controller.getSnapshot().fit),
  );
}
