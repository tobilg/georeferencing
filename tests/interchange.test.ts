import { exportPoints, worldFile } from "@georeferencing/plugins/serializers";
import Feature from "ol/Feature.js";
import LineString from "ol/geom/LineString.js";
import { expect, it } from "vitest";
import { validateFeatures } from "../packages/core/src/core/geometry.js";
import {
  importPoints,
  parseSession,
} from "../packages/core/src/core/interchange.js";
import {
  project,
  projectExtent,
} from "../packages/core/src/core/projection.js";
import { fitTransform } from "../packages/core/src/core/transform.js";
import { createDocument } from "../packages/core/src/core/types.js";
import { toGeographicFeature } from "../packages/openlayers/src/geometry.js";
import { fixture } from "./fixtures/models.js";

it("OUT-01 densified projected lines retain their path, ID and properties", () => {
  const mercator = ([lon, lat]: number[]) => [
    (6378137 * lon * Math.PI) / 180,
    6378137 * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
  ];
  const a = mercator([-80, 0]),
    b = mercator([-60, 70]);
  const feature = new Feature(new LineString([a, b]));
  feature.setId("curve");
  feature.set("name", "projected diagonal");
  const result = toGeographicFeature(feature, "EPSG:3857", 100);
  expect(result.id).toBe("curve");
  expect(result.properties).toEqual({ name: "projected diagonal" });
  const points = (result.geometry as GeoJSON.LineString).coordinates;
  expect(points.length).toBeGreaterThan(2);
  for (let i = 1; i < points.length; i++) {
    const middle = mercator([
      (points[i - 1][0] + points[i][0]) / 2,
      (points[i - 1][1] + points[i][1]) / 2,
    ]);
    const distance =
      Math.abs(
        (b[0] - a[0]) * (a[1] - middle[1]) - (a[0] - middle[0]) * (b[1] - a[1]),
      ) / Math.hypot(b[0] - a[0], b[1] - a[1]);
    expect(distance).toBeLessThan(100);
  }
});
it("GCP-07 enabled flags, negative source Y, fractional precision round trip", () => {
  const d = createDocument("EPSG:3857");
  d.gcps = fixture("polynomial1");
  d.gcps[2].enabled = false;
  d.gcps[1].image[0] = 99.123456789;
  const text = exportPoints(d),
    imported = importPoints(text);
  expect(text).toContain("sourceX,sourceY,enable,dX,dY,residual");
  expect(
    imported.gcps.map(({ image, target, enabled }) => ({
      image,
      target,
      enabled,
    })),
  ).toEqual(
    d.gcps.map(({ image, target, enabled }) => ({ image, target, enabled })),
  );
  expect(() =>
    importPoints("mapX,mapY,pixelX,pixelY,enable\n1,2,3,,1", "EPSG:3857"),
  ).toThrow();
  d.gcps[0].crs = "EPSG:4326";
  d.gcps[0].target = [9, 0];
  expect(importPoints(exportPoints(d)).gcps[0].target[0]).toBeCloseTo(
    1001875.4171394621,
    6,
  );
});
it("AC-22 world file describes first pixel center and rotation; rejects unsupported paths", () => {
  const fit = fitTransform(fixture("helmert"), "helmert"),
    result = worldFile(fit, "EPSG:3857", "EPSG:3857");
  const values = result.text.trim().split("\n").map(Number);
  expect(values[0]).toBeCloseTo(2, 9);
  expect(values[1]).toBeCloseTo(0.5, 9);
  expect(values[2]).toBeCloseTo(0.5, 9);
  expect(values[3]).toBeCloseTo(-2, 9);
  expect(values[4]).toBeCloseTo(1001.25, 9);
  expect(values[5]).toBeCloseTo(1999.25, 9);
  expect(() => worldFile(fit, "EPSG:3857", "EPSG:4326")).toThrow();
  expect(() =>
    worldFile(
      fitTransform(fixture("polynomial1"), "polynomial1"),
      "EPSG:3857",
      "EPSG:3857",
    ),
  ).toThrow();
});
it("affine world files are opt-in and exact", () => {
  const fit = fitTransform(fixture("polynomial1"), "polynomial1"),
    result = worldFile(fit, "EPSG:3857", "urn:ogc:def:crs:EPSG::3857", {
      affine: true,
    });
  const [a, d, b, e, c, f] = result.text.trim().split("\n").map(Number);
  // known.polynomial1: X = 1000 + 2x + 0.3y, Y = 2000 + 0.2x - 3y
  for (const [x, y] of [
    [0.5, 0.5],
    [80, 20],
  ]) {
    const px = x - 0.5,
      py = y - 0.5;
    expect(a * px + b * py + c).toBeCloseTo(1000 + 2 * x + 0.3 * y, 6);
    expect(d * px + e * py + f).toBeCloseTo(2000 + 0.2 * x - 3 * y, 6);
  }
  expect(() =>
    worldFile(
      fitTransform(fixture("polynomial2"), "polynomial2"),
      "EPSG:3857",
      "EPSG:3857",
      { affine: true },
    ),
  ).toThrow(/affine/);
});
it("AC-26 supplied projected CRS converts; unknown and wrapped CRS fails explicitly", () => {
  const definitions = {
    "EPSG:25832": "+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs +type=crs",
  };
  const q = project([500000, 0], "EPSG:25832", "EPSG:4326", definitions);
  expect(q[0]).toBeCloseTo(9, 9);
  expect(q[1]).toBeCloseTo(0, 9);
  expect(() => project([1, 2], "EPSG:9999", "EPSG:4326")).toThrow(/Missing/);
  expect(() =>
    projectExtent([170, -10, 190, 10], "EPSG:4326", "EPSG:3857"),
  ).toThrow(/Wrapped/);
});
it("DIG-08/12 valid holes survive; self-intersections and invalid GeoJSON fail", () => {
  const feature = {
    type: "Feature" as const,
    id: "polygon",
    properties: { label: "test" },
    geometry: {
      type: "Polygon" as const,
      coordinates: [
        [
          [0, 0],
          [3, 0],
          [3, 3],
          [0, 3],
          [0, 0],
        ],
        [
          [1, 1],
          [1, 2],
          [2, 2],
          [2, 1],
          [1, 1],
        ],
      ],
    },
  };
  expect(
    validateFeatures({ type: "FeatureCollection", features: [feature] }),
  ).toEqual([]);
  feature.geometry.coordinates = [
    [
      [0, 0],
      [3, 3],
      [3, 0],
      [0, 3],
      [0, 0],
    ],
  ];
  expect(
    validateFeatures({ type: "FeatureCollection", features: [feature] }).length,
  ).toBeGreaterThan(0);
  expect(
    validateFeatures(
      { type: "FeatureCollection", features: [feature] },
      "draft",
    ),
  ).toEqual([]);
  for (const coordinates of [null, [null], [[]], [[[null, 1]]]]) {
    expect(
      validateFeatures(
        {
          type: "FeatureCollection",
          features: [
            {
              ...feature,
              geometry: { type: "Polygon", coordinates: coordinates as never },
            },
          ],
        },
        "draft",
      ).length,
    ).toBeGreaterThan(0);
  }
  expect(() =>
    parseSession(
      JSON.stringify({ ...createDocument("EPSG:3857"), schemaVersion: 2 }),
    ),
  ).toThrow(/schema/);
});

it("AC-23 actual QGIS 3.44 desktop .points preserves WKT, disabled flag and fractional pixels", async () => {
  const { readFileSync } = await import("node:fs");
  const text = readFileSync("tests/fixtures/qgis-3.44.points", "utf8"),
    imported = importPoints(text);
  expect(imported.crs).toMatch(/^PROJCRS\[/);
  expect(imported.gcps.map((p) => p.enabled)).toEqual([
    true,
    true,
    true,
    false,
  ]);
  expect(imported.gcps[0].image).toEqual([0.125, 0.5]);
  expect(imported.gcps[0].target).toEqual([1000.123456789, 2000.987654321]);
  expect(
    project(imported.gcps[0].target, imported.crs, "EPSG:3857")[0],
  ).toBeCloseTo(1000.123456789, 8);
  const d = createDocument(imported.crs);
  d.gcps = imported.gcps;
  const again = importPoints(exportPoints(d));
  expect(again.crs).toBe(imported.crs);
  expect(
    again.gcps.map(({ image, target, enabled }) => ({
      image,
      target,
      enabled,
    })),
  ).toEqual(
    imported.gcps.map(({ image, target, enabled }) => ({
      image,
      target,
      enabled,
    })),
  );
  expect(
    importPoints("mapX\tmapY\tpixelX\tpixelY\n1\t2\t3\t-4", "EPSG:3857").gcps[0]
      .image,
  ).toEqual([3, 4]);
});
it("OUT-07 malformed/future session documents fail before applying state", () => {
  const base = createDocument("EPSG:3857");
  for (const doc of [
    null,
    [],
    { ...base, workingCrs: "" },
    { ...base, gcps: [null] },
    { ...base, output: { ...base.output, bounds: { length: 4 } } },
    { ...base, output: { ...base.output, resolution: "12" } },
    { ...base, output: { ...base.output, noData: 256 } },
    { ...base, confirmedAlignmentRevision: 0 },
  ])
    expect(() => parseSession(JSON.stringify(doc))).toThrow();
});

it("AC-26 injected NTv2 grids agree with independent GDAL/PROJ; missing grids are structured errors", async () => {
  const { readFileSync } = await import("node:fs"),
    { registerDatumGrids } = await import(
      "../packages/core/src/core/projection.js"
    );
  const reference = JSON.parse(
    readFileSync("tests/fixtures/datum-grid.json", "utf8"),
  );
  const definitions = {
    "TEST:SHIFT":
      "+proj=longlat +ellps=WGS84 +nadgrids=constant-shift.gsb +type=crs",
  };
  expect(() =>
    project([9, 48], "TEST:SHIFT", "EPSG:4326", definitions),
  ).toThrow(/Required datum grid/);
  const buffer = readFileSync("tests/fixtures/constant-shift.gsb");
  registerDatumGrids({
    "constant-shift.gsb": buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ),
  });
  for (let i = 0; i < reference.input.length; i++) {
    const p = project(
      reference.input[i],
      "TEST:SHIFT",
      "EPSG:4326",
      definitions,
    );
    p.forEach((v, c) => {
      expect(v).toBeCloseTo(reference.expected[i][c], 9);
    });
    const back = project(p, "EPSG:4326", "TEST:SHIFT", definitions);
    back.forEach((v, c) => {
      expect(v).toBeCloseTo(reference.input[i][c], 9);
    });
  }
});

it("OUT-01 explicit projected adapter preserves identity/properties and densifies geographic segments", async () => {
  const { featuresInCrs } = await import(
    "../packages/core/src/core/coordinates.js"
  );
  const features = {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        id: "stable",
        properties: { name: "A", nested: { value: 3 } },
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [9, 0],
            [10, 70],
          ],
        },
      },
    ],
  };
  const before = JSON.stringify(features),
    projected = featuresInCrs(features, "EPSG:3857", 100);
  expect(projected.type).toBe("ProjectedFeatureCollection");
  expect(projected.crs).toBe("EPSG:3857");
  expect(projected.features[0].id).toBe("stable");
  expect(projected.features[0].properties).toEqual(
    features.features[0].properties,
  );
  expect(
    (projected.features[0].geometry as GeoJSON.LineString).coordinates.length,
  ).toBeGreaterThan(2);
  expect(JSON.stringify(features)).toBe(before);
});
