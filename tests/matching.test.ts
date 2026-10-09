import { describe, expect, it } from "vitest";
import { checkCapabilities } from "../packages/matching/src/backend.js";
import {
  area,
  corners,
  densifyBoundary,
  intersect,
  inverse,
  multiply,
  processingToQuery,
  transform,
  validateSearchExtent,
} from "../packages/matching/src/geometry.js";
import {
  estimateMemoryBytes,
  validateRequest,
} from "../packages/matching/src/pixels.js";
import {
  createSnapshot,
  createWmsProvider,
  wmsRequestUrl,
} from "../packages/matching/src/reference.js";
import {
  DEFAULT_MATCH_OPTIONS,
  type Matrix3,
} from "../packages/matching/src/types.js";
import { syntheticPlan } from "./fixtures/matching.js";
import { image, query, snapshot } from "./matching-suite.js";

describe("matching contracts", () => {
  it("preserves crop, centre, resize and projective round trips", () => {
    const h = processingToQuery(
      { x: 13, y: 25, width: 600, height: 400 },
      300,
      200,
    );
    expect(transform(h, [0, 0])).toEqual([14, 26]);
    expect(transform(multiply(inverse(h), h), [41, 52])).toEqual([41, 52]);
    const q = corners({ x: 0, y: 0, width: 100, height: 100 });
    expect(
      area(intersect(q, corners({ x: 50, y: 0, width: 100, height: 100 }))),
    ).toBe(5000);
  });
  it("checks actual backend exports", () =>
    expect(() => checkCapabilities({ AKAZE: () => {} })).toThrow("SIFT"));
  it("preserves core restrictions on wrapped geographic searches", () => {
    expect(() => validateSearchExtent([170, 0, 190, 10], "EPSG:4326")).toThrow(
      "Wrapped",
    );
  });
  it("densifies boundaries under nonlinear CRS conversion", () => {
    const projected = densifyBoundary(
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      ([x, y]) => [x, y + x * x],
      0.1,
    );
    expect(projected.length).toBeGreaterThan(20);
    expect(projected).toContainEqual([5, 25]);
  });
  it("rejects malformed and over-budget buffers before backend allocation", () => {
    expect(() =>
      validateRequest({
        query: { width: 5001, height: 5000, data: new Uint8Array() },
        reference: snapshot(),
      }),
    ).toThrow("budget");
    expect(() =>
      validateRequest({
        query: { width: 1, height: 1, data: new Uint8Array(3) },
        reference: snapshot(),
      }),
    ).toThrow("RGBA");
  });
  it("budgets default query and reference pixel limits together", () => {
    const o = DEFAULT_MATCH_OPTIONS;
    expect(
      estimateMemoryBytes(o.maxQueryPixels, o.maxReferencePixels, o),
    ).toBeLessThanOrEqual(o.maxMemoryBytes);
  });
  it("strips credential-like source parameters", () => {
    const s = createSnapshot({
      id: "params",
      width: image.width,
      height: image.height,
      extent: [0, 0, 640, 640],
      crs: "EPSG:3857",
      source: {
        id: "plan",
        revision: "1",
        layers: ["plan"],
        parameters: {
          TIME: "2026",
          KEY: "k",
          sig: "s",
          "X-Amz-Signature": "a",
          access_key: "b",
          SESSIONID: "c",
        },
      },
      tiles: [{ ...image, x: 0, y: 0 }],
    });
    expect(s.source.parameters).toEqual({ TIME: "2026" });
  });
  it("captures immutable owned pixels", () => {
    const s = snapshot();
    const original = s.tiles[0].data[0];
    image.data[0] = 0;
    expect(s.tiles[0].data[0]).toBe(original);
    image.data[0] = 255;
    expect(Object.isFrozen(s)).toBe(true);
  });
  it("handles WMS axis order, parameters and exact dimensions", () => {
    const options = {
      url: "https://host.invalid/wms",
      source: {
        id: "wms",
        revision: "1",
        layers: ["ivl"],
        styles: ["engineering"],
      },
      parameters: { TIME: "2026-01-01", CQL_FILTER: "id=2" },
      decode: async () => image,
    };
    const selection = {
      extent: [10, 50, 11, 51] as [number, number, number, number],
      crs: "EPSG:4326",
      resolution: 0.1,
      layers: ["ivl"],
    };
    const url = new URL(
      wmsRequestUrl(options, selection, selection.extent, 10, 10),
    );
    expect(url.searchParams.get("BBOX")).toBe("50,10,51,11");
    expect(url.searchParams.get("CQL_FILTER")).toBe("id=2");
    expect(url.searchParams.get("STYLES")).toBe("engineering");
    const subset = new URL(
      wmsRequestUrl(
        {
          ...options,
          source: {
            ...options.source,
            layers: ["other", "ivl"],
            styles: undefined,
          },
          parameters: { STYLES: "other-style,engineering" },
        },
        selection,
        selection.extent,
        10,
        10,
      ),
    );
    expect(subset.searchParams.get("STYLES")).toBe("engineering");
    expect(
      new URL(
        wmsRequestUrl(
          { ...options, version: "1.1.1" },
          selection,
          selection.extent,
          10,
          10,
        ),
      ).searchParams.get("BBOX"),
    ).toBe("10,50,11,51");
  });
  it("tiles acquisition inside the selection and fails missing source data explicitly", async () => {
    const requests: URL[] = [];
    const provider = createWmsProvider({
      url: "https://host.invalid/wms",
      source: { id: "wms", revision: "1", layers: ["ivl"] },
      maxTileSize: 10,
      request: async (url) => {
        requests.push(new URL(url));
        return new Blob();
      },
      decode: async () => syntheticPlan(10, 10),
    });
    const s = await provider.acquire({
      extent: [0, 0, 20, 20],
      crs: "EPSG:3857",
      resolution: 1,
      layers: ["ivl"],
    });
    expect(s.tiles).toHaveLength(4);
    expect(requests.map((u) => u.searchParams.get("BBOX"))).toEqual([
      "0,10,10,20",
      "10,10,20,20",
      "0,0,10,10",
      "10,0,20,10",
    ]);
  });
  it("cancels reference acquisition during transport and decoding", async () => {
    for (const stage of ["request", "decode"]) {
      const abort = new AbortController();
      const provider = createWmsProvider({
        url: "https://host.invalid/wms",
        source: { id: "wms", revision: "1", layers: ["ivl"] },
        request: async () => {
          if (stage === "request") abort.abort();
          return new Blob();
        },
        decode: async () => {
          if (stage === "decode") abort.abort();
          return image;
        },
      });
      await expect(
        provider.acquire(
          {
            extent: [0, 0, 640, 640],
            crs: "EPSG:3857",
            resolution: 1,
            layers: ["ivl"],
          },
          abort.signal,
        ),
      ).rejects.toMatchObject({ name: "AbortError" });
    }
  });
});

it("rejects collinear support and projective poles through core domain validation", async () => {
  const { validateCandidate } = await import(
    "../packages/matching/src/validation.js"
  );
  const { imageSampler, referenceSampler } = await import(
    "../packages/matching/src/pixels.js"
  );
  const r = snapshot(),
    region = { x: 0, y: 0, width: 250, height: 260 };
  const line = Array.from({ length: 24 }, (_, i) => ({
    query: [10 + i * 8, 10 + i * 8] as [number, number],
    reference: [140 + i * 8, 170 + i * 8] as [number, number],
    distance: 0.1,
  }));
  expect(() =>
    validateCandidate(
      line,
      line,
      region,
      r,
      DEFAULT_MATCH_OPTIONS,
      imageSampler(query),
      referenceSampler(r),
    ),
  ).toThrow();
  const grid = Array.from({ length: 25 }, (_, i) => [
    10 + (i % 5) * 55,
    10 + Math.floor(i / 5) * 55,
  ]);
  const mirrored = grid.map(([x, y]) => ({
    query: [x, y] as [number, number],
    reference: [400 - x, 160 + y] as [number, number],
    distance: 0.1,
  }));
  expect(() =>
    validateCandidate(
      mirrored,
      mirrored,
      region,
      r,
      DEFAULT_MATCH_OPTIONS,
      imageSampler(query),
      referenceSampler(r),
    ),
  ).toThrow("reflected-geometry");
  const pole = [1, 0, 100, 0, 1, 100, 0.01, 0, -1.25] as Matrix3;
  const pairs = Array.from({ length: 25 }, (_, i) => {
    const q: [number, number] = [
      10 + (i % 5) * 50,
      10 + Math.floor(i / 5) * 50,
    ];
    return { query: q, reference: transform(pole, q), distance: 0.1 };
  });
  expect(() =>
    validateCandidate(
      pairs,
      pairs,
      region,
      r,
      DEFAULT_MATCH_OPTIONS,
      imageSampler(query),
      referenceSampler(r),
    ),
  ).toThrow();
});
