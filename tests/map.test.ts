import type { FeatureCollection } from "geojson";
import { describe, expect, it, vi } from "vitest";
import { GeoreferencerController } from "../packages/core/src/core/controller.js";
import { fitTransform } from "../packages/core/src/core/transform.js";
import type { Engine } from "../packages/core/src/engine/index.js";
import type {
  ReferenceSource,
  WfsReference,
} from "../packages/core/src/map/index.js";
import {
  extentToImageView,
  imageViewToExtent,
  loadReferenceData,
  loadWfsGeoJson,
  snapToReferences,
  toGeographic,
  watchReferences,
} from "../packages/core/src/map/index.js";
import { fixture } from "./fixtures/models.js";

const square: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "a",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0],
          ],
        ],
      },
    },
  ],
};
// Screen = data coordinates scaled by 10 px per unit.
const toScreen = ([x, y]: number[]) => [x * 10, y * 10] as [number, number];

describe("snapToReferences", () => {
  it("snaps to the nearest vertex within tolerance, with provenance", () => {
    const result = snapToReferences(
      [97, 3],
      [{ id: "ref", data: square, options: { tolerancePx: 5 } }],
      toScreen,
    );
    expect(result).toEqual({
      coordinate: [10, 0],
      reference: { sourceId: "ref", featureId: "a" },
    });
    expect(
      snapToReferences(
        [50, 30],
        [{ id: "ref", data: square, options: { tolerancePx: 5 } }],
        toScreen,
      ),
    ).toBeNull();
  });
  it("snaps to edges when enabled and skips features outside the search box", () => {
    const sources = [
      {
        id: "ref",
        data: square,
        options: { vertices: false, edges: true, tolerancePx: 5 },
      },
    ];
    const edge = snapToReferences([50, 3], sources, toScreen);
    expect(edge?.coordinate[0]).toBeCloseTo(5, 9);
    expect(edge?.coordinate[1]).toBeCloseTo(0, 9);
    expect(
      snapToReferences([50, 3], sources, toScreen, [20, 20, 30, 30]),
    ).toBeNull();
  });
});

describe("linked navigation helpers", () => {
  it("round-trips an image viewport through a map extent", () => {
    const fit = fitTransform(fixture("polynomial1"), "polynomial1");
    const extent = imageViewToExtent(
      fit,
      [10, 20, 30, 40],
      "EPSG:3857",
      "EPSG:3857",
    )!;
    const view = extentToImageView(fit, extent, "EPSG:3857", "EPSG:3857")!;
    // The enclosing extent of a sheared view maps back to a box containing it.
    expect(view[0]).toBeLessThanOrEqual(10 + 1e-6);
    expect(view[1]).toBeLessThanOrEqual(20 + 1e-6);
    expect(view[0] + view[2]).toBeGreaterThanOrEqual(40 - 1e-6);
    expect(view[1] + view[3]).toBeGreaterThanOrEqual(60 - 1e-6);
  });
});

describe("toGeographic", () => {
  it("converts every geometry type and keeps IDs and properties", () => {
    const projected: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: 7,
          properties: { name: "x" },
          geometry: {
            type: "GeometryCollection",
            geometries: [
              { type: "MultiPoint", coordinates: [[111319.49079327357, 0]] },
              {
                type: "Polygon",
                coordinates: [
                  [
                    [0, 0],
                    [111319.49079327357, 0],
                    [0, 111325.14286638486],
                    [0, 0],
                  ],
                ],
              },
            ],
          },
        },
      ],
    };
    const result = toGeographic(projected, "EPSG:3857");
    const feature = result.features[0];
    expect(feature.id).toBe(7);
    expect(feature.properties).toEqual({ name: "x" });
    const [points, polygon] = (
      feature.geometry as { geometries: { coordinates: number[][][] }[] }
    ).geometries;
    expect(points.coordinates[0][0]).toBeCloseTo(1, 9);
    expect(polygon.coordinates[0][2][1]).toBeCloseTo(1, 6);
    expect(() => toGeographic(projected, "EPSG:99999")).toThrow(/projection/);
  });
});

const wfs = (pages: object[], extra: Partial<WfsReference> = {}) => {
  const calls: string[] = [];
  const provider: WfsReference = {
    id: "wfs",
    label: "WFS",
    kind: "wfs",
    url: "https://example.invalid/wfs",
    version: "2.0.0",
    typeNames: ["t"],
    requestCrs: "EPSG:3857",
    axisOrder: "xy",
    responseFormat: "geojson",
    pageSize: 1,
    request: async (url) => {
      calls.push(url);
      return new Response(JSON.stringify(pages[calls.length - 1]));
    },
    ...extra,
  };
  return { provider, calls };
};
const query = () => ({
  extent: [0, 0, 10, 10] as [number, number, number, number],
  crs: "EPSG:3857",
  resolution: 1,
  signal: new AbortController().signal,
});
const point = (id: string | undefined, x: number, extra = {}) => ({
  type: "Feature",
  ...(id ? { id } : {}),
  properties: { code: `c-${x}` },
  geometry: { type: "Point", coordinates: [x, 2] },
  ...extra,
});

describe("loadWfsGeoJson", () => {
  it("pages, deduplicates, honours idProperty and axis order", async () => {
    const { provider, calls } = wfs(
      [
        {
          type: "FeatureCollection",
          numberMatched: 2,
          features: [point(undefined, 1)],
        },
        {
          type: "FeatureCollection",
          numberMatched: 2,
          features: [point(undefined, 3)],
        },
      ],
      { idProperty: "code", responseAxisOrder: "yx" },
    );
    const result = await loadWfsGeoJson(provider, query());
    expect(calls).toHaveLength(2);
    expect(result.partial).toBe(false);
    expect(result.crs).toBe("EPSG:3857");
    expect(result.data.features.map((f) => f.id)).toEqual(["c-1", "c-3"]);
    expect(
      (result.data.features[0].geometry as { coordinates: number[] })
        .coordinates,
    ).toEqual([2, 1]);
  });
  it("reports missing IDs and refuses GML", async () => {
    const missing = wfs([
      { type: "FeatureCollection", features: [point(undefined, 1)] },
    ]);
    await expect(loadWfsGeoJson(missing.provider, query())).rejects.toThrow(
      /stable IDs/,
    );
    const gml = wfs([], { responseFormat: "gml" });
    await expect(loadWfsGeoJson(gml.provider, query())).rejects.toThrow(
      /GeoJSON only/,
    );
  });
});

describe("loadReferenceData", () => {
  it("returns longitude/latitude for static and custom sources", async () => {
    const data: FeatureCollection = {
      type: "FeatureCollection",
      features: [point("p", 111319.49079327357) as never],
    };
    const geojson = await loadReferenceData(
      { id: "g", label: "G", kind: "geojson", crs: "EPSG:3857", data },
      null,
    );
    expect(geojson.crs).toBe("EPSG:4326");
    expect(
      (geojson.data.features[0].geometry as { coordinates: number[] })
        .coordinates[0],
    ).toBeCloseTo(1, 9);
    const load = vi.fn(async () => ({ data, crs: "EPSG:3857", partial: true }));
    const custom = await loadReferenceData(
      { id: "c", label: "C", kind: "custom", queryCrs: "EPSG:3857", load },
      query(),
    );
    expect(load).toHaveBeenCalledOnce();
    expect(custom.partial).toBe(true);
  });
});

const engine: Engine = {
  run: async () => {
    throw Error("unused");
  },
  dispose() {},
};

describe("watchReferences", () => {
  it("reports statuses, follows the viewport and discards superseded results", async () => {
    vi.useFakeTimers();
    try {
      const controller = new GeoreferencerController({
        workingCrs: "EPSG:3857",
        engine,
      });
      const applied: (string | null)[] = [];
      let release: (() => void) | undefined;
      let loads = 0;
      const providers: ReferenceSource[] = [
        {
          id: "c",
          label: "Custom",
          kind: "custom",
          queryCrs: "EPSG:3857",
          load: async () => ({
            data: square,
            crs: "EPSG:3857",
            partial: false,
          }),
        },
      ];
      const watcher = watchReferences(providers, {
        controller,
        view: () => ({
          extent: [0, 0, 10, 10],
          crs: "EPSG:3857",
          resolution: 1,
        }),
        async load() {
          const n = ++loads;
          if (n === 1)
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          return { data: `load-${n}`, partial: false };
        },
        apply: (_, data) => applied.push(data),
      });
      await vi.advanceTimersByTimeAsync(200);
      expect(controller.getSnapshot().references.c.state).toBe("loading");
      // Navigation supersedes the first, still pending request.
      watcher.refreshViewport();
      await vi.advanceTimersByTimeAsync(200);
      release?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(applied).toEqual(["load-2"]);
      expect(controller.getSnapshot().references.c).toMatchObject({
        label: "Custom",
        state: "ready",
      });
      watcher.dispose();
      expect(controller.getSnapshot().references.c).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("controller.setPreviewCrs", () => {
  it("renders previews in the requested CRS and re-renders an existing preview", async () => {
    const outputs: string[] = [];
    const controller = new GeoreferencerController({
      workingCrs: "EPSG:3857",
      guard: async () => "discard",
      engine: {
        dispose() {},
        run: async (request) => {
          if (request.kind === "inspect")
            return {
              metadata: {
                id: "i",
                name: "a.png",
                width: 100,
                height: 100,
                originalWidth: 100,
                originalHeight: 100,
                orientation: 1,
                format: "png",
                fingerprint: "a".repeat(64),
                sizeBytes: 1,
                pixelConvention: "normalized-top-left-corner-y-down",
                georeferenced: false,
              },
              imagePreview: new Blob(["p"]),
              elapsedMs: 1,
            };
          if (request.kind === "fit")
            return {
              fit: fitTransform(request.gcps, request.model),
              elapsedMs: 1,
            };
          if (request.kind !== "render") throw Error("unexpected");
          outputs.push(request.output.crs);
          return {
            raster: {
              width: 1,
              height: 1,
              data: new Uint8ClampedArray(4),
              bounds: [0, 0, 1, 1],
              crs: request.output.crs,
              estimatedBytes: 4,
            },
            elapsedMs: 1,
          };
        },
      },
    });
    await controller.loadImage(new File(["x"], "a.png"));
    controller.replaceGcps(fixture("polynomial1"));
    await vi.waitFor(() =>
      expect(controller.getSnapshot().preview).not.toBeNull(),
    );
    controller.setPreviewCrs("EPSG:4326");
    await vi.waitFor(() =>
      expect(controller.getSnapshot().preview?.crs).toBe("EPSG:4326"),
    );
    controller.setPreviewCrs(null);
    await vi.waitFor(() =>
      expect(controller.getSnapshot().preview?.crs).toBe("EPSG:3857"),
    );
    expect(outputs).toEqual(["EPSG:3857", "EPSG:4326", "EPSG:3857"]);
    expect(() => controller.setPreviewCrs(" ")).toThrow(/empty/);
    controller.dispose();
  });
});
