/**
 * Dedicated module-worker entry point, exported as an asset at
 * `@georeferencing/core/worker`. Use createWorkerEngine to send jobs rather than
 * importing this module on the main thread. Each job echoes revision/operation
 * identity; raster buffers transfer to the caller and cancellation terminates
 * the worker. No state is shared between jobs.
 * @module worker
 * @internal
 */
import type { DatumGrids, Definitions } from "../core/projection.js";
import { project, registerDatumGrids } from "../core/projection.js";
import { fitTransform, validateDomain } from "../core/transform.js";
import type { Limits } from "../core/types.js";
import { fail } from "../core/types.js";
import { checkBudget } from "./budget.js";
import { decodeImage, inspectImage, maskSourceNoData } from "./image.js";
import type { EngineRequest, EngineResult, JobTag } from "./index.js";
import {
  DEFAULT_APPROXIMATION_ERROR,
  outputGrid,
  PREVIEW_APPROXIMATION_ERROR,
  warp,
} from "./warp.js";

const workerScope = globalThis as unknown as {
  onmessage: (e: MessageEvent) => void;
  postMessage: (data: unknown, transfer?: Transferable[]) => void;
};
workerScope.onmessage = async ({
  data,
}: MessageEvent<{
  request: EngineRequest;
  tag: JobTag;
  operationId: string;
  limits: Limits;
  definitions: Definitions;
  datumGrids?: DatumGrids;
}>) => {
  const { request: r, tag, operationId, limits, definitions } = data,
    started = performance.now();
  const send = (payload: object, transfer: Transferable[] = []) =>
    workerScope.postMessage({ tag, operationId, ...payload }, transfer);
  try {
    registerDatumGrids(data.datumGrids);
    let result: EngineResult = { elapsedMs: 0 };
    if (r.kind === "inspect") {
      const metadata = await inspectImage(r.file, limits),
        pixels = await decodeImage(
          r.file,
          metadata,
          limits.previewMaxDimension,
          limits.maxMemoryBytes,
        );
      const canvas = new OffscreenCanvas(pixels.width, pixels.height);
      canvas
        .getContext("2d")!
        .putImageData(
          new ImageData(
            pixels.data as Uint8ClampedArray<ArrayBuffer>,
            pixels.width,
            pixels.height,
          ),
          0,
          0,
        );
      result = {
        ...result,
        metadata,
        imagePreview: await canvas.convertToBlob({ type: "image/png" }),
      };
      canvas.width = 0;
    } else if (r.kind === "normalize") {
      checkBudget(
        r.metadata.width,
        r.metadata.height,
        limits,
        r.file.size,
        r.metadata.width * r.metadata.height,
      );
      const pixels = await decodeImage(
          r.file,
          r.metadata,
          undefined,
          limits.maxMemoryBytes,
        ),
        canvas = new OffscreenCanvas(pixels.width, pixels.height);
      const context = canvas.getContext("2d");
      if (!context)
        fail(
          "MEMORY_BUDGET",
          "The browser could not allocate the normalized image canvas.",
        );
      try {
        context!.putImageData(
          new ImageData(
            pixels.data as Uint8ClampedArray<ArrayBuffer>,
            pixels.width,
            pixels.height,
          ),
          0,
          0,
        );
        send({ progress: 0.8 });
        result.blob = await canvas.convertToBlob({ type: "image/png" });
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    } else if (r.kind === "fit") {
      if (r.gcps.length > limits.maxGcps)
        fail("BUDGET", "Configured GCP budget exceeded.");
      const fit = fitTransform(
        r.gcps.map((p) => ({
          ...p,
          target: project(p.target, p.crs, r.workingCrs, definitions),
        })),
        r.model,
      );
      validateDomain(fit, r.metadata.width, r.metadata.height);
      result.fit = fit;
    } else if (r.kind === "encode") {
      fail("EXPORT_PLUGIN", "Encoding requires the selected plugin worker.");
    } else {
      const grid = outputGrid(
        r.fit,
        r.metadata,
        r.workingCrs,
        r.output,
        limits,
        definitions,
        r.preview,
      );
      const pixels = await decodeImage(
        r.file,
        r.metadata,
        r.preview ? limits.previewMaxDimension : undefined,
        limits.maxMemoryBytes,
      );
      maskSourceNoData(pixels, r.output.sourceNoData);
      const raster = warp(
        pixels,
        r.metadata,
        r.fit,
        r.workingCrs,
        grid,
        r.output.resampler,
        definitions,
        (progress) => send({ progress: progress * 0.8 }),
        r.preview
          ? PREVIEW_APPROXIMATION_ERROR
          : (r.output.approximationError ?? DEFAULT_APPROXIMATION_ERROR),
      );
      if (r.preview && r.output.noData !== undefined)
        maskSourceNoData(raster, r.output.noData);
      result.raster = raster;
    }
    result.elapsedMs = performance.now() - started;
    send(
      { result },
      result.raster ? [result.raster.data.buffer as ArrayBuffer] : [],
    );
  } catch (error) {
    const e = error as Error & { code?: string; recoverable?: boolean };
    send({
      error: {
        code: e.code ?? "ENGINE",
        message: e.message ?? String(error),
        recoverable: e.recoverable !== false,
      },
    });
  }
};
