/**
 * Minimal worker protocol for optional raster encoders. This entry is for plugin
 * workers; it imports no input decoders, React components or concrete encoders.
 * @module @georeferencing/core/encoder-worker
 * @group @georeferencing/core
 */

import type { DatumGrids, Definitions } from "../core/projection.js";
import type { Limits } from "../core/types.js";
import { fail } from "../core/types.js";
import type { EncodeRequest, JobTag } from "./index.js";

/** Per-job encoder context supplied by the same configured processing engine. */
export interface EncoderContext {
  /** Host projection definitions for output CRS metadata. */
  definitions: Definitions;
  /** Host datum-grid bytes, available to codecs that need projection operations. */
  datumGrids: DatumGrids;
  /** Host workload limits; pixel/buffer checks run before calling the encoder. */
  limits: Limits;
  /** Report progress fractions from zero to one. */
  onProgress: (fraction: number) => void;
}

/** Optional codec implementation installed in a dedicated module worker. */
export interface RasterEncoder {
  /** Format ID accepted by this worker, such as geotiff or jpeg. */
  id: string;
  /** Encode the transferred raster locally without mutating its pixel values. */
  encode(request: EncodeRequest, context: EncoderContext): Promise<Blob>;
}

/**
 * Install the revision-tagged encoder protocol inside a dedicated module worker.
 * Importing this module is SSR-safe; calling this function is worker-only.
 * Completed jobs transfer raster ownership back along with the encoded Blob.
 * Cancellation is handled by the engine terminating the dedicated worker.
 */
export function installEncoderWorker(encoder: RasterEncoder): void {
  const scope = globalThis as unknown as {
    onmessage: (event: MessageEvent) => void;
    postMessage: (message: unknown, transfer?: Transferable[]) => void;
  };
  scope.onmessage = async ({
    data,
  }: MessageEvent<{
    request: EncodeRequest;
    tag: JobTag;
    operationId: string;
    definitions: Definitions;
    datumGrids: DatumGrids;
    limits: Limits;
  }>) => {
    const { request, tag, operationId, definitions, limits } = data;
    const start = performance.now();
    const send = (value: object, transfer: Transferable[] = []) =>
      scope.postMessage({ tag, operationId, ...value }, transfer);
    try {
      if (request.kind !== "encode" || request.format !== encoder.id)
        fail("EXPORT_PLUGIN", `This worker only encodes ${encoder.id}.`);
      const { raster } = request;
      if (
        !Number.isSafeInteger(raster.width) ||
        !Number.isSafeInteger(raster.height) ||
        raster.width < 1 ||
        raster.height < 1 ||
        raster.width * raster.height > limits.maxOutputPixels ||
        raster.data.length !== raster.width * raster.height * 4 ||
        raster.data.byteLength * 6 > limits.maxMemoryBytes
      )
        fail(
          "OUTPUT_BUDGET",
          "Encoder raster exceeds the configured pixel or memory budget.",
        );
      const blob = await encoder.encode(request, {
        definitions,
        datumGrids: data.datumGrids,
        limits,
        onProgress: (progress) => send({ progress }),
      });
      send({ result: { blob, raster, elapsedMs: performance.now() - start } }, [
        raster.data.buffer as ArrayBuffer,
      ]);
    } catch (error) {
      const e = error as Error & { code?: string; recoverable?: boolean };
      send({
        error: {
          code: e.code ?? "ENCODER",
          message: e.message ?? String(error),
          recoverable: e.recoverable !== false,
        },
      });
    }
  };
}
