import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { fitTransform } from "../packages/core/src/core/transform.js";
import type {
  Extent,
  Gcp,
  ImageMetadata,
  Model,
  Resampler,
} from "../packages/core/src/core/types.js";
import { warp } from "../packages/core/src/engine/warp.js";

const fixtures = JSON.parse(
  readFileSync("tests/fixtures/qgis-rasters.json", "utf8"),
) as {
  qgis: string;
  sources: Record<string, string>;
  definitions: Record<string, string>;
  records: {
    model: Model;
    gcps: Gcp[];
    resampler: Resampler;
    scale: string;
    variant: string;
    crs: string;
    workingCrs: string;
    sourceWidth: number;
    sourceHeight: number;
    bounds: Extent;
    width: number;
    height: number;
    rgbaZlib: string;
  }[];
};
for (const f of fixtures.records)
  it(`AC-21/22/24 pinned QGIS raster ${f.model} ${f.resampler} ${f.scale} ${f.variant} ${f.crs}`, () => {
    const fit = fitTransform(f.gcps, f.model),
      expected = inflateSync(Buffer.from(f.rgbaZlib, "base64"));
    const input = {
      data: new Uint8ClampedArray(
        Buffer.from(fixtures.sources[f.variant], "base64"),
      ),
      width: f.sourceWidth,
      height: f.sourceHeight,
    };
    const result = warp(
      input,
      {
        ...input,
        id: "fixture",
        name: "fixture",
        sizeBytes: 1,
        fingerprint: "0".repeat(64),
        format: "png",
        orientation: 1,
        originalWidth: input.width,
        originalHeight: input.height,
        pixelConvention: "normalized-top-left-corner-y-down",
        georeferenced: false,
      } as ImageMetadata,
      fit,
      f.workingCrs,
      {
        width: f.width,
        height: f.height,
        bounds: f.bounds,
        crs: f.crs,
        estimatedBytes: 0,
      },
      f.resampler,
      fixtures.definitions,
    );
    let max = 0,
      alpha = 0;
    for (let i = 0; i < expected.length; i++) {
      const delta = Math.abs(expected[i] - result.data[i]);
      max = Math.max(max, delta);
      if (i % 4 === 3) alpha = Math.max(alpha, delta);
    }
    expect(max).toBeLessThanOrEqual(1);
    expect(alpha).toBe(0);
  });
