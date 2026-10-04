import { readFileSync } from "node:fs";
import { fromArrayBuffer } from "geotiff";
import { expect, it } from "vitest";
import { fitTransform, forward } from "../packages/core/src/core/transform.js";
import type {
  ImageMetadata,
  Resampler,
} from "../packages/core/src/core/types.js";
import { DEFAULT_LIMITS } from "../packages/core/src/core/types.js";
import { inspectImage } from "../packages/core/src/engine/image.js";
import { outputGrid, sample, warp } from "../packages/core/src/engine/warp.js";
import {
  encodeGeoTiff,
  encodeGeoTiffOutput,
} from "../packages/plugins/src/tiff.js";
import { fixture } from "./fixtures/models.js";

const metadata: ImageMetadata = {
  id: "grid",
  fingerprint: "a".repeat(64),
  name: "grid",
  sizeBytes: 1000,
  width: 100,
  height: 100,
  originalWidth: 100,
  originalHeight: 100,
  orientation: 1,
  format: "png",
  pixelConvention: "normalized-top-left-corner-y-down",
  georeferenced: false,
};
it("AC-18/22 real GeoTIFF has north-up pixel-corner placement, EPSG, RGBA and unassociated alpha", async () => {
  const data = new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 1, 2, 3, 255,
  ]);
  const file = await fromArrayBuffer(
    encodeGeoTiff(data, 2, 2, [1000, 1994, 1004, 2000], "EPSG:3857", false),
  );
  const img = await file.getImage();
  expect(img.getGeoKeys()?.ProjectedCSTypeGeoKey).toBe(3857);
  expect(img.getGeoKeys()?.GTRasterTypeGeoKey).toBe(1);
  expect(img.getBoundingBox()).toEqual([1000, 1994, 1004, 2000]);
  expect(img.getResolution()).toEqual([2, -3, 0]);
  expect(Array.from(await img.readRasters({ interleave: true }))).toEqual([
    ...data,
  ]);
});
it("AC-02 file limit accepts exactly 25 MiB; larger rejected before reading bytes", async () => {
  const png = readFileSync("tests/fixtures/grid.png"),
    bytes = new Uint8Array(DEFAULT_LIMITS.maxFileBytes);
  bytes.set(png);
  const limit = new File([bytes], "at-limit.png");
  expect((await inspectImage(limit, DEFAULT_LIMITS)).width).toBe(100);
  const above = new File([bytes, new Uint8Array(1)], "above-limit.png");
  Object.defineProperty(above, "arrayBuffer", {
    value: () => {
      throw Error("must not read");
    },
  });
  await expect(inspectImage(above, DEFAULT_LIMITS)).rejects.toThrow(
    /byte limit/,
  );
});
it("OUT-05 lossless Deflate preserves color, alpha, CRS and footprint", async () => {
  const data = new Uint8ClampedArray(
    Array.from({ length: 1024 }, (_, i) => [
      i % 256,
      33,
      241,
      i % 3 ? 255 : 0,
    ]).flat(),
  );
  const bytes = await encodeGeoTiffOutput(
    data,
    32,
    32,
    [8, 48, 9, 49],
    "EPSG:4326",
    true,
    "deflate",
  );
  expect(bytes.byteLength).toBeLessThan(data.length);
  const file = await fromArrayBuffer(bytes),
    image = await file.getImage();
  expect(image.getFileDirectory().getValue("Compression")).toBe(8);
  expect(image.getGeoKeys()?.GeographicTypeGeoKey).toBe(4326);
  expect(image.getBoundingBox()).toEqual([8, 48, 9, 49]);
  expect([...(await image.readRasters({ interleave: true }))]).toEqual([
    ...data,
  ]);
});
it("IMG-03/AC-29 huge dimensions and excessive output are rejected before allocation", async () => {
  const png = new Uint8Array(readFileSync("tests/fixtures/grid.png")),
    view = new DataView(png.buffer);
  view.setUint32(16, 10000);
  view.setUint32(20, 10000);
  await expect(
    inspectImage(new File([png], "too-big.png"), DEFAULT_LIMITS),
  ).rejects.toThrow(/input limit/);
  const fit = fitTransform(fixture("polynomial1"), "polynomial1");
  expect(() =>
    outputGrid(
      fit,
      metadata,
      "EPSG:3857",
      { crs: "EPSG:3857", resolution: [1e-9, 1e-9], resampler: "nearest" },
      DEFAULT_LIMITS,
    ),
  ).toThrow(/Output exceeds/);
});
for (const resampler of [
  "nearest",
  "bilinear",
  "cubic",
  "cubicSpline",
  "lanczos",
] as Resampler[])
  it(`AC-22 ${resampler}: constant color and premultiplied alpha remain correct`, () => {
    const src = {
      width: 3,
      height: 3,
      data: new Uint8ClampedArray(
        Array.from({ length: 9 }, () => [200, 100, 50, 128]).flat(),
      ),
    };
    const out = new Uint8ClampedArray(4);
    sample(src, 1.2, 1.6, resampler, out, 0);
    expect([...out]).toEqual([200, 100, 50, 128]);
  });
it("AC-24 quadratic raster landmark agrees with independent forward formula", () => {
  const fit = fitTransform(fixture("polynomial2"), "polynomial2"),
    data = new Uint8ClampedArray(100 * 100 * 4);
  for (let y = 30; y < 40; y++)
    for (let x = 20; x < 30; x++) {
      data[(y * 100 + x) * 4] = 255;
      data[(y * 100 + x) * 4 + 3] = 255;
    }
  const grid = outputGrid(
    fit,
    metadata,
    "EPSG:3857",
    { crs: "EPSG:3857", resolution: [0.5, 0.5], resampler: "nearest" },
    DEFAULT_LIMITS,
  );
  const raster = warp(
    { width: 100, height: 100, data },
    metadata,
    fit,
    "EPSG:3857",
    grid,
    "nearest",
  );
  const knownX = 1000 + 2 * 25 + 0.002 * 25 * 35,
    knownY = 2000 - 3 * 35 + 0.001 * 25 * 25;
  const x = Math.floor((knownX - raster.bounds[0]) / 0.5),
    y = Math.floor((raster.bounds[3] - knownY) / 0.5);
  expect(raster.data[(y * raster.width + x) * 4]).toBe(255);
  expect(forward(fit, [25, 35])[0]).toBeCloseTo(knownX, 8);
});

it("OUT-05 strip compression, predictor and numeric no-data independently decode", async () => {
  const { encodeGeoTiffBlob } = await import("../packages/plugins/src/tiff.js");
  const data = new Uint8ClampedArray(19 * 17 * 4);
  for (let p = 0; p < data.length; p += 4)
    data.set([p % 253, (p * 7) % 253, 181, p % 20 ? 255 : 0], p);
  for (const compression of ["none", "deflate", "packbits"] as const) {
    for (const noData of [undefined, 254]) {
      const blob = await encodeGeoTiffBlob(
        data,
        19,
        17,
        [9, 48, 10, 49],
        "EPSG:4326",
        true,
        {
          compression,
          rowsPerStrip: 3,
          predictor: compression === "deflate" ? 2 : 1,
          noData,
        },
      );
      const file = await fromArrayBuffer(await blob.arrayBuffer()),
        image = await file.getImage(),
        samples = await image.readRasters({ interleave: true });
      expect(
        await image.getFileDirectory().loadValue("StripOffsets"),
      ).toHaveLength(6);
      expect(image.getBoundingBox()).toEqual([9, 48, 10, 49]);
      expect(image.getGDALNoData()).toBe(noData ?? null);
      const channels = noData === undefined ? 4 : 3;
      expect(image.getSamplesPerPixel()).toBe(channels);
      for (let p = 0; p < 19 * 17; p++)
        for (let c = 0; c < channels; c++)
          expect(samples[p * channels + c]).toBe(
            noData !== undefined && data[p * 4 + 3] === 0
              ? 254
              : data[p * 4 + c],
          );
    }
  }
  data[3] = 128;
  await expect(
    encodeGeoTiffBlob(data, 19, 17, [9, 48, 10, 49], "EPSG:4326", true, {
      noData: 254,
    }),
  ).rejects.toThrow(/partial transparency/i);
});
it("approximate transformer stays within its tolerance and 0 maps exactly", () => {
  const size = 64,
    input = {
      width: size,
      height: size,
      data: new Uint8ClampedArray(size * size * 4),
    };
  // Horizontal gradient: a source x error of e pixels changes bilinear output by ~4e.
  for (let i = 0; i < size * size; i++) {
    input.data.set([(i % size) * 4, 0, 0, 255], i * 4);
  }
  const meta = { ...metadata, width: size, height: size };
  const fit = fitTransform(
    fixture("thinPlateSpline").map((p) => ({
      ...p,
      image: [(p.image[0] * size) / 100, (p.image[1] * size) / 100],
    })),
    "thinPlateSpline",
  );
  const grid = outputGrid(
    fit,
    meta,
    "EPSG:3857",
    { crs: "EPSG:3857", resampler: "bilinear" },
    DEFAULT_LIMITS,
  );
  const exact = warp(
    input,
    meta,
    fit,
    "EPSG:3857",
    grid,
    "bilinear",
    {},
    undefined,
    0,
  );
  const fast = warp(
    input,
    meta,
    fit,
    "EPSG:3857",
    grid,
    "bilinear",
    {},
    undefined,
    0.125,
  );
  const tight = warp(input, meta, fit, "EPSG:3857", grid, "bilinear");
  // Compare interior pixels; edge pixels may move across the image border.
  let fastMax = 0,
    tightMax = 0,
    edges = 0;
  for (let i = 0; i < exact.data.length; i += 4) {
    const inside =
      exact.data[i + 3] === 255 &&
      fast.data[i + 3] === 255 &&
      tight.data[i + 3] === 255;
    if (!inside) {
      if (exact.data[i + 3] !== fast.data[i + 3]) edges++;
      continue;
    }
    fastMax = Math.max(fastMax, Math.abs(fast.data[i] - exact.data[i]));
    tightMax = Math.max(tightMax, Math.abs(tight.data[i] - exact.data[i]));
  }
  expect(fastMax).toBeLessThanOrEqual(Math.ceil(4 * 0.125) + 1);
  expect(tightMax).toBeLessThanOrEqual(1);
  expect(edges).toBeLessThan(grid.width + grid.height);
  expect(() =>
    outputGrid(
      fit,
      meta,
      "EPSG:3857",
      { crs: "EPSG:3857", resampler: "bilinear", approximationError: 2 },
      DEFAULT_LIMITS,
    ),
  ).toThrow(/Approximation error/);
});
it("GeoTIFF eligibility is known before rendering and accepts EPSG URN aliases", async () => {
  const { geoTiff } = await import("../packages/plugins/src/geotiff.js");
  const { geoTiffEpsg } = await import("../packages/plugins/src/tiff.js");
  const format = geoTiff();
  const doc = (
    output: Partial<
      import("../packages/core/src/core/types.js").OutputSettings
    >,
  ) =>
    ({
      output: { crs: "EPSG:3857", resampler: "bilinear", ...output },
    }) as never;
  expect(format.unavailable?.(doc({}), null)).toBeNull();
  expect(format.unavailable?.(doc({ crs: "ESRI:102100" }), null)).toMatch(
    /EPSG/,
  );
  expect(format.unavailable?.(doc({ crs: "EPSG:900913" }), null)).toMatch(
    /32767/,
  );
  expect(format.unavailable?.(doc({ predictor: 2 }), null)).toMatch(/Deflate/);
  expect(geoTiffEpsg("urn:ogc:def:crs:EPSG::25832")).toBe(25832);
  const tiff = await fromArrayBuffer(
    await encodeGeoTiffOutput(
      new Uint8ClampedArray(4).fill(255),
      1,
      1,
      [0, 0, 1, 1],
      "http://www.opengis.net/def/crs/EPSG/0/25832",
      false,
    ),
  );
  expect((await tiff.getImage()).getGeoKeys()?.ProjectedCSTypeGeoKey).toBe(
    25832,
  );
});
