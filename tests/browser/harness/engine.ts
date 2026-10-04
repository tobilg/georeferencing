import type { Model, OutputSettings } from "@georeferencing/core/core";
import {
  createWorkerEngine,
  type JobTag,
  type Raster,
} from "@georeferencing/core/engine";
import GeoreferencingWorker from "@georeferencing/core/worker?worker";
import GeoTiffWorker from "@georeferencing/plugins/geotiff-worker?worker";
import { fixture } from "../../fixtures/models.js";

const engine = createWorkerEngine({
  workerFactory: () => new GeoreferencingWorker(),
});
export const encodeRaster = (
  raster: Raster,
  output: OutputSettings,
  tag: JobTag,
) =>
  engine.run({ kind: "encode", format: "geotiff", raster, output }, tag, {
    workerFactory: () => new GeoTiffWorker(),
  });
export async function runEngine(
  file: File,
  model: Model = "polynomial1",
  compression: "none" | "deflate" = "none",
) {
  const tag = {
    documentId: "engine-check",
    imageId: "engine-check",
    alignmentRevision: 1,
  };
  const inspected = await engine.run({ kind: "inspect", file }, tag),
    metadata = inspected.metadata!;
  const gcps = fixture(model).map((p) => ({
    ...p,
    image: [
      (p.image[0] * metadata.width) / 100,
      (p.image[1] * metadata.height) / 100,
    ] as [number, number],
  }));
  const { fit } = await engine.run(
    { kind: "fit", gcps, model, workingCrs: "EPSG:3857", metadata },
    tag,
  );
  const output = {
    crs: "EPSG:3857",
    resampler: "nearest" as const,
    resolution: [2, 3] as [number, number],
    compression,
  };
  const preview = await engine.run(
    {
      kind: "render",
      file,
      metadata,
      fit: fit!,
      workingCrs: "EPSG:3857",
      output,
      preview: true,
    },
    tag,
  );
  const rendered = await engine.run(
    {
      kind: "render",
      file,
      metadata,
      fit: fit!,
      workingCrs: "EPSG:3857",
      output,
      preview: false,
    },
    tag,
  );
  const encoded = await encodeRaster(rendered.raster!, output, tag);
  const result = {
    ...encoded,
    elapsedMs: rendered.elapsedMs + encoded.elapsedMs,
  };
  const canvas = document.querySelector("canvas")!;
  canvas.width = preview.raster!.width;
  canvas.height = preview.raster!.height;
  canvas
    .getContext("2d")!
    .putImageData(
      new ImageData(
        preview.raster!.data as Uint8ClampedArray<ArrayBuffer>,
        canvas.width,
        canvas.height,
      ),
      0,
      0,
    );
  return { metadata, fit, preview, result };
}
declare global {
  interface Window {
    engine: typeof engine;
    encodeRaster: typeof encodeRaster;
    runEngine: typeof runEngine;
  }
}
Object.assign(window, { runEngine, engine, encodeRaster });
document.querySelector("input")!.onchange = async (e) => {
  try {
    const result = await runEngine((e.target as HTMLInputElement).files![0]);
    document.querySelector("pre")!.textContent = JSON.stringify(
      {
        dimensions: result.metadata,
        fit: result.fit,
        output: result.result.raster?.bounds,
      },
      null,
      2,
    );
  } catch (e) {
    document.querySelector("pre")!.textContent = String(e);
  }
};
