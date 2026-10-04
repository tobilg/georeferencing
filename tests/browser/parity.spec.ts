import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Model } from "../../packages/core/src/core/types.js";
import type { WfsReference } from "../../packages/core/src/openlayers/references.js";
import type {} from "./harness/validation.js";

// Type-only global augmentation lives with the validation entry; avoid importing its runtime.
test.beforeEach(async ({ page }) => {
  await page.goto("/validation.html");
  await page.waitForFunction(
    () => window.validation?.editors.filter(Boolean).length === 2,
  );
});
test("AC-07/08/26 WFS 1.1/2 GML, CRS axes, capabilities, paging, schema and budgets", async ({
  page,
}) => {
  const caps = readFileSync("tests/fixtures/wfs/capabilities-2.xml", "utf8"),
    schema = readFileSync("tests/fixtures/wfs/schema.xsd", "utf8");
  const result = await page.evaluate(
    async ({ caps, schema }) => {
      const v = window.validation,
        signal = new AbortController().signal;
      const discovery = await v.discoverWfs({
        url: "https://example.invalid/wfs",
        version: "2.0.0",
        signal,
        request: async () => new Response(caps),
      });
      const properties = await v.describeWfsFeatureType(
        {
          url: "https://example.invalid/wfs",
          version: "2.0.0",
          signal,
          request: async () => new Response(schema),
        },
        ["test:sites"],
      );
      const output = [];
      for (const version of ["1.1.0", "2.0.0"] as const)
        for (const [crs, pos, axis] of [
          ["urn:ogc:def:crs:EPSG::4326", "48 9", undefined],
          ["urn:ogc:def:crs:OGC:1.3:CRS84", "9 48", undefined],
          ["EPSG:4326", "9 48", "xy"],
          [
            "http://www.opengis.net/def/crs/EPSG/0/25832",
            "500000 5316300.224451495",
            undefined,
          ],
        ] as const) {
          const requests: string[] = [];
          const provider: WfsReference = {
            kind: "wfs",
            id: "test",
            label: "test",
            url: "https://example.invalid/wfs",
            version,
            typeNames: ["test:sites"],
            requestCrs: "EPSG:4326",
            responseFormat: "gml",
            axisOrder: "yx",
            responseAxisOrder: axis,
            pageSize: 1,
            supportsStartIndex: true,
            request: async (url) => {
              requests.push(url);
              const index = Number(new URL(url).searchParams.get("startIndex"));
              const gml =
                  version === "2.0.0"
                    ? "http://www.opengis.net/gml/3.2"
                    : "http://www.opengis.net/gml",
                wfs =
                  version === "2.0.0"
                    ? "http://www.opengis.net/wfs/2.0"
                    : "http://www.opengis.net/wfs",
                member =
                  version === "2.0.0" ? "wfs:member" : "gml:featureMember";
              const body =
                index < 2
                  ? `<${member}><test:sites ${version === "2.0.0" ? "gml:id" : "fid"}="site-${index}"><test:geometry><gml:Point srsName="${crs}"><gml:pos>${pos}</gml:pos></gml:Point></test:geometry><test:label>Site ${index}</test:label></test:sites></${member}>`
                  : "";
              return new Response(
                `<wfs:FeatureCollection xmlns:wfs="${wfs}" xmlns:gml="${gml}" xmlns:test="https://example.invalid/test" ${version === "2.0.0" ? 'numberMatched="2"' : `numberOfFeatures="${index < 2 ? 1 : 0}"`}>${body}</wfs:FeatureCollection>`,
              );
            },
          };
          const loaded = await v.loadWfs(
            provider,
            {
              extent: [8, 47, 10, 49],
              crs: "EPSG:4326",
              resolution: 1,
              signal,
            },
            "EPSG:3857",
          );
          output.push({
            version,
            crs,
            partial: loaded.partial,
            ids: loaded.features.map((f) => f.getId()),
            point: (
              loaded.features[0].getGeometry() as import("ol/geom/Point.js").default
            ).getCoordinates(),
            requests,
          });
        }
      const missing = await v
        .loadWfs(
          {
            kind: "wfs",
            id: "bad",
            label: "bad",
            url: "/wfs",
            version: "2.0.0",
            typeNames: ["test:sites"],
            requestCrs: "EPSG:3857",
            axisOrder: "xy",
            responseFormat: "geojson",
            maxResponseBytes: 12,
            request: async () => new Response("x".repeat(100)),
          },
          { extent: [0, 0, 1, 1], crs: "EPSG:3857", resolution: 1, signal },
          "EPSG:3857",
        )
        .catch((e) => e.code);
      return { discovery, properties, output, missing };
    },
    { caps, schema },
  );
  expect(result.discovery).toMatchObject({
    version: "2.0.0",
    paging: true,
    featureTypes: [
      { name: "test:sites", defaultCrs: "EPSG:25832", otherCrs: ["EPSG:4326"] },
    ],
  });
  expect(result.properties).toEqual([
    {
      name: "geometry",
      type: "gml:PointPropertyType",
      optional: false,
      nillable: false,
      multiple: false,
    },
    {
      name: "label",
      type: "xsd:string",
      optional: true,
      nillable: true,
      multiple: false,
    },
    {
      name: "tags",
      type: "xsd:string",
      optional: true,
      nillable: false,
      multiple: true,
    },
  ]);
  for (const resultCase of result.output) {
    expect(resultCase.partial, JSON.stringify(resultCase)).toBe(false);
    expect(resultCase.ids).toEqual(["site-0", "site-1"]);
    expect(resultCase.point[0]).toBeCloseTo(1001875.4171394621, 4);
    expect(resultCase.point[1]).toBeCloseTo(6106854.834885074, 3);
    expect(new URL(resultCase.requests[0]).searchParams.get("bbox")).toBe(
      "47,8,49,10,EPSG:4326",
    );
    expect(resultCase.requests.length).toBe(
      resultCase.version === "1.1.0" ? 3 : 2,
    );
  }
  expect(result.missing).toBe("REFERENCE_BUDGET");
});

test("AC-20/27/32 two Strict Mode editors isolate drafts, restore geometry and survive map projection changes", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const v = window.validation,
      file = new File(
        [await (await fetch(window.validation.gridUrl)).blob()],
        "grid.png",
      );
    for (const e of v.editors) {
      await e.controller.loadImage(file);
      e.controller.replaceGcps(v.fixture("polynomial1"));
    }
  });
  await page.waitForFunction(() =>
    window.validation.editors.every((e) => e.controller.getSnapshot().fit),
  );
  const before = await page.evaluate(() =>
    window.validation.editors.map((e) => ({
      layers: e.map.getLayers().getLength(),
      interactions: e.map.getInteractions().getLength(),
    })),
  );
  const doc = await page.evaluate(() => {
    const c = window.validation.editors[0].controller;
    c.confirm();
    c.setFeatures({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "drawing-stable",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0.009, 0.016],
                [0.012, 0.016],
                [0.012, 0.018],
                [0.009, 0.018],
                [0.009, 0.016],
              ],
              [
                [0.01, 0.0165],
                [0.01, 0.017],
                [0.011, 0.017],
                [0.011, 0.0165],
                [0.01, 0.0165],
              ],
            ],
          },
          properties: { name: "Survey area", nested: { a: [1, "x"] } },
        },
      ],
    });
    return c.getSnapshot().document;
  });
  for (const crs of ["EPSG:4326", "EPSG:25832", "EPSG:3857"]) {
    const result = await page.evaluate(
      ({ crs }) => {
        const v = window.validation,
          e = v.editors[0],
          center = v.project([1115, 1860], "EPSG:3857", crs, v.definitions);
        e.map.setView(
          new v.View({
            projection: crs,
            center,
            resolution: crs === "EPSG:4326" ? 0.00001 : 1,
          }),
        );
        e.map.renderSync();
        const draft = e.map
          .getLayers()
          .getArray()
          .flatMap((layer) => {
            const source = (
              layer as import("ol/layer/Vector.js").default
            ).getSource?.();
            const feature =
              source && "getFeatureById" in source
                ? source.getFeatureById("drawing-stable")
                : null;
            return feature ? [feature] : [];
          })[0] as import("ol/Feature.js").default | undefined;
        const drawn = draft
          ? v.toGeographicFeature(
              draft,
              crs,
              crs === "EPSG:4326" ? 1e-6 : 0.1,
              v.definitions,
            )
          : null;
        return {
          doc: e.controller.getSnapshot().document,
          other:
            v.editors[1].controller.getSnapshot().document.features.features,
          host: e.host
            .getSource()!
            .getFeatures()
            .map((f) => f.getId()),
          drawn,
        };
      },
      { crs },
    );
    expect(result.doc).toEqual(doc);
    expect(result.other).toEqual([]);
    expect(result.host).toEqual(["unrelated-host-0"]);
    expect(result.drawn?.id).toBe("drawing-stable");
    expect(result.drawn?.properties).toEqual(
      doc.features.features[0].properties,
    );
    const rings = (result.drawn!.geometry as GeoJSON.Polygon).coordinates;
    expect(rings).toHaveLength(2);
    rings.forEach((ring, r) => {
      ring.forEach((point, p) => {
        point.forEach((n, c) => {
          expect(n).toBeCloseTo(
            (doc.features.features[0].geometry as GeoJSON.Polygon).coordinates[
              r
            ][p][c],
            8,
          );
        });
      });
    });
  }
  await page.evaluate(() => window.validation.editors[0].detach());
  await expect(
    page
      .getByRole("region", { name: "Editor 1", exact: true })
      .locator(".rg-editor"),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.validation.editors[0].map.getLayers().getLength(),
    ),
  ).toBe(1);
  expect(
    await page.evaluate(() =>
      window.validation.editors[1].map.getLayers().getLength(),
    ),
  ).toBe(before[1].layers);
  await page.evaluate(() => window.validation.editors[0].attach());
  await expect(
    page
      .getByRole("region", { name: "Editor 1", exact: true })
      .locator(".rg-editor"),
  ).toHaveCount(1);
  expect(
    await page.evaluate(() =>
      window.validation.editors[0].map.getLayers().getLength(),
    ),
  ).toBe(before[0].layers);
  const restored = await page.evaluate(async () => {
    const c = window.validation.editors[0].controller,
      s = JSON.stringify(c.getSnapshot().document),
      file = new File(
        [await (await fetch(window.validation.gridUrl)).blob()],
        "grid.png",
      );
    await c.restoreSession(s, file);
    return c.getSnapshot().document;
  });
  expect(restored.features).toEqual(doc.features);
  expect(restored.provenanceByFeatureId).toEqual(doc.provenanceByFeatureId);
});

test("AC-26 workers use injected datum grids and report missing resources without substitution", async ({
  page,
}) => {
  const grid = readFileSync("tests/fixtures/constant-shift.gsb").toString(
    "base64",
  );
  const result = await page.evaluate(async (grid) => {
    const v = window.validation,
      bytes = Uint8Array.from(atob(grid), (c) => c.charCodeAt(0)).buffer;
    const definition = {
      "TEST:SHIFT":
        "+proj=longlat +ellps=WGS84 +nadgrids=constant-shift.gsb +type=crs",
    };
    const noGrid = v.engineFactory(undefined, definition),
      withGrid = v.engineFactory({ "constant-shift.gsb": bytes }, definition);
    const file = new File(
        [await (await fetch(window.validation.gridUrl)).blob()],
        "grid.png",
      ),
      tag = { documentId: "grid", imageId: "image", alignmentRevision: 1 };
    const { metadata } = await withGrid.run({ kind: "inspect", file }, tag);
    const gcps = [
      [0, 0],
      [100, 0],
      [0, 100],
    ].map(([x, y], i) => ({
      id: `p${i}`,
      label: i + 1,
      image: [x, y] as [number, number],
      target: [9 + x * 0.001, 48 - y * 0.001] as [number, number],
      enabled: true,
      crs: "TEST:SHIFT",
    }));
    const request = {
      kind: "fit" as const,
      model: "polynomial1" as const,
      metadata: metadata!,
      gcps,
      workingCrs: "EPSG:3857",
    };
    const missing = await noGrid.run(request, tag).then(
      () => null,
      (e) => ({ code: e.code, operationId: e.operationId, message: e.message }),
    );
    const { fit } = await withGrid.run(request, tag);
    return { missing, fit, bytes: bytes.byteLength };
  }, grid);
  expect(result.missing?.code).toBe("GRID");
  expect(result.missing?.operationId).toBeTruthy();
  expect(result.missing?.message).toContain("constant-shift.gsb");
  expect(result.fit?.rmse).toBeLessThan(1e-6);
  expect(result.bytes).toBeGreaterThan(352);
});

test("REF-11/FIT-08/NFR-06 keyboard image history, histogram display and seven-model linked views", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const e = window.validation.editors[0];
    await e.controller.loadImage(
      new File(
        [await (await fetch(window.validation.gridUrl)).blob()],
        "grid.png",
      ),
    );
    e.controller.replaceGcps(window.validation.fixture("polynomial1"));
  });
  await page.waitForFunction(() =>
    Boolean(window.validation.editors[0].controller.getSnapshot().fit),
  );
  const region = page.getByRole("region", { name: "Editor 1", exact: true }),
    viewer = region.locator("svg.rg-image-view");
  const original = await viewer.getAttribute("viewBox");
  await viewer.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("+");
  const changed = await viewer.getAttribute("viewBox");
  expect(changed).not.toBe(original);
  await region
    .getByRole("button", { name: "Previous image view", exact: true })
    .click();
  expect(await viewer.getAttribute("viewBox")).toBe(original);
  await region
    .getByRole("button", { name: "Next image view", exact: true })
    .click();
  expect(await viewer.getAttribute("viewBox")).toBe(changed);
  await region
    .getByText("Display adjustment & histogram", { exact: true })
    .click();
  const revision = await page.evaluate(
    () =>
      window.validation.editors[0].controller.getSnapshot().document
        .documentRevision,
  );
  await region
    .getByRole("button", { name: "Full histogram stretch", exact: true })
    .click();
  await region
    .getByRole("button", { name: "Local histogram stretch", exact: true })
    .click();
  await region
    .getByRole("button", { name: "Reset display", exact: true })
    .click();
  expect(
    await page.evaluate(
      () =>
        window.validation.editors[0].controller.getSnapshot().document
          .documentRevision,
    ),
  ).toBe(revision);
  for (const model of [
    "linear",
    "helmert",
    "polynomial1",
    "polynomial2",
    "polynomial3",
    "projective",
    "thinPlateSpline",
  ] as Model[]) {
    await page.evaluate((model) => {
      const v = window.validation,
        c = v.editors[0].controller;
      c.setLinkedNavigation("off");
      c.replaceGcps(v.fixture(model));
      c.setModel(model);
    }, model);
    await page.waitForFunction(
      (model) =>
        window.validation.editors[0].controller.getSnapshot().fit?.model ===
        model,
      model,
    );
    const result = await page.evaluate(() => {
      const e = window.validation.editors[0],
        c = e.controller;
      c.setLinkedNavigation("image-to-map");
      c.setImageView([20, 20, 60, 60]);
      e.map.renderSync();
      const extent = e.map.getView().calculateExtent(e.map.getSize());
      c.setLinkedNavigation("map-to-image");
      e.map.getView().setCenter([1110, 1850]);
      e.map.dispatchEvent("moveend");
      return {
        extent,
        imageView: c.getSnapshot().imageView,
        error: c.getSnapshot().error,
      };
    });
    expect(result.extent.every(Number.isFinite)).toBe(true);
    expect(result.imageView!.every(Number.isFinite)).toBe(true);
    expect(result.imageView![2]).toBeGreaterThan(0);
    expect(result.error).toBeNull();
  }
});

test("AC-24 nonlinear preview and exported raster landmarks meet independent QGIS displacement tolerances", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const records = JSON.parse(
    readFileSync("tests/fixtures/qgis-transforms.json", "utf8"),
  ).records.filter(
    (r: { model: string; case: string }) =>
      r.case === "exact" &&
      ["polynomial2", "polynomial3", "projective", "thinPlateSpline"].includes(
        r.model,
      ),
  );
  const results = await page.evaluate(async (records) => {
    const engine = window.validation.engineFactory(),
      canvas = document.createElement("canvas");
    canvas.width = 960;
    canvas.height = 960;
    const context = canvas.getContext("2d")!,
      pixels = context.createImageData(960, 960);
    for (let y = 0; y < 960; y++)
      for (let x = 0; x < 960; x++) {
        const p = (y * 960 + x) * 4,
          g =
            255 -
            Math.round(
              255 *
                Math.exp(
                  -((x + 0.5 - 192) ** 2 + (y + 0.5 - 288) ** 2) /
                    (2 * 12 ** 2),
                ),
            );
        pixels.data.set([255, g, g, 255], p);
      }
    context.putImageData(pixels, 0, 0);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), "image/png"),
    );
    canvas.width = 0;
    const file = new File([blob], "landmark.png"),
      tag = { documentId: "landmark", imageId: "source", alignmentRevision: 1 },
      { metadata } = await engine.run({ kind: "inspect", file }, tag),
      results = [];
    for (const record of records) {
      const gcps = record.gcps.map(
        (p: import("../../packages/core/src/core/types.js").Gcp) => ({
          ...p,
          image: p.image.map((n) => n * 9.6),
        }),
      );
      const { fit } = await engine.run(
        {
          kind: "fit",
          model: record.model,
          gcps,
          metadata: metadata!,
          workingCrs: "EPSG:3857",
        },
        tag,
      );
      const measurements = [];
      for (const preview of [true, false]) {
        const { raster } = await engine.run(
          {
            kind: "render",
            file,
            metadata: metadata!,
            fit: fit!,
            workingCrs: "EPSG:3857",
            output: { crs: "EPSG:3857", resampler: "bilinear" },
            preview,
          },
          tag,
        );
        let sum = 0,
          cx = 0,
          cy = 0;
        for (let y = 0; y < raster!.height; y++)
          for (let x = 0; x < raster!.width; x++) {
            const p = (y * raster!.width + x) * 4,
              w = Math.max(0, raster!.data[p] - raster!.data[p + 1]);
            sum += w;
            cx += (x + 0.5) * w;
            cy += (y + 0.5) * w;
          }
        const expected = record.qgisForward[0].slice(1),
          px =
            ((expected[0] - raster!.bounds[0]) /
              (raster!.bounds[2] - raster!.bounds[0])) *
            raster!.width,
          py =
            ((raster!.bounds[3] - expected[1]) /
              (raster!.bounds[3] - raster!.bounds[1])) *
            raster!.height;
        measurements.push({
          preview,
          displacement: Math.hypot(cx / sum - px, cy / sum - py),
          width: raster!.width,
          height: raster!.height,
        });
      }
      results.push({ model: record.model, measurements });
    }
    return results;
  }, records);
  mkdirSync("artifacts/reports", { recursive: true });
  writeFileSync(
    `artifacts/reports/preview-displacement-${test.info().project.name}.json`,
    `${JSON.stringify(
      {
        browser: test.info().project.name,
        version: page.context().browser()?.version(),
        sourcePixels: [960, 960],
        results,
      },
      null,
      2,
    )}\n`,
  );
  for (const result of results)
    for (const measurement of result.measurements)
      expect(
        measurement.displacement,
        JSON.stringify(result),
      ).toBeLessThanOrEqual(measurement.preview ? 1 : 0.25);
});

test("AC-08/09 reference errors, incomplete results and late replacement are visible without blocking manual GCPs", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const v = window.validation,
      e = v.editors[0];
    await e.controller.loadImage(
      new File(
        [await (await fetch(window.validation.gridUrl)).blob()],
        "grid.png",
      ),
    );
    e.setReferences([
      {
        kind: "custom",
        id: "offline",
        label: "Offline survey",
        queryCrs: "EPSG:3857",
        load: async () => {
          throw Error("Fixture authentication failure");
        },
      },
    ]);
  });
  const region = page.getByRole("region", { name: "Editor 1", exact: true });
  await expect(
    region.getByRole("region", { name: "Reference sources" }),
  ).toContainText("Reference unavailable");
  await page.evaluate(() => {
    const c = window.validation.editors[0].controller;
    c.addGcp([0, 0], [1000, 2000]);
  });
  expect(
    await page.evaluate(
      () =>
        window.validation.editors[0].controller.getSnapshot().document.gcps
          .length,
    ),
  ).toBe(1);
  await page.evaluate(() => {
    const e = window.validation.editors[0];
    e.setReferences([
      {
        kind: "custom",
        id: "slow",
        label: "Old query",
        queryCrs: "EPSG:3857",
        load: async () => {
          await new Promise((r) => setTimeout(r, 600));
          return {
            data: { type: "FeatureCollection", features: [] },
            crs: "EPSG:3857",
            partial: false,
            message: "OLD RESULT MUST BE IGNORED",
          };
        },
      },
    ]);
  });
  await expect(
    region.getByRole("region", { name: "Reference sources" }),
  ).toContainText("Old query");
  await page.evaluate(() =>
    window.validation.editors[0].setReferences([
      {
        kind: "custom",
        id: "new",
        label: "New survey",
        queryCrs: "EPSG:3857",
        loading: "fixed",
        queryBounds: [800, 1600, 1400, 2100],
        load: async () => ({
          data: { type: "FeatureCollection", features: [] },
          crs: "EPSG:3857",
          partial: true,
          message: "Fixture feature limit",
        }),
      },
    ]),
  );
  await expect(
    region.getByRole("region", { name: "Reference sources" }),
  ).toContainText("Incomplete reference results");
  await page.waitForTimeout(700);
  await expect(
    region.getByRole("region", { name: "Reference sources" }),
  ).not.toContainText("OLD RESULT");
  expect(
    await page.evaluate(() =>
      Object.keys(
        window.validation.editors[0].controller.getSnapshot().references,
      ),
    ),
  ).toEqual(["new"]);
  expect(
    await page.evaluate(
      () =>
        window.validation.editors[0].controller.getSnapshot().document.gcps[0]
          .target,
    ),
  ).toEqual([1000, 2000]);
});
