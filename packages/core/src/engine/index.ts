/**
 * Lazy browser worker processing, concurrency budgets and raw raster rendering.
 * Import from `@georeferencing/core/engine`.
 * @module @georeferencing/core/engine
 * @group @georeferencing/core
 */
import type { DatumGrids, Definitions } from "../core/projection.js";
import type { Fit } from "../core/transform.js";
import type {
  Gcp,
  ImageMetadata,
  Limits,
  Model,
  OutputSettings,
} from "../core/types.js";
import { DEFAULT_LIMITS, GeoreferenceError, uid } from "../core/types.js";
import type { Raster } from "./warp.js";

export type { Pixels } from "./image.js";
export {
  DEFAULT_APPROXIMATION_ERROR,
  outputGrid,
  PREVIEW_APPROXIMATION_ERROR,
  sample,
  warp,
} from "./warp.js";
export type { Fit, Raster };
/**
 * Declared capabilities of the bundled JavaScript engine. See the capabilities guide for
 * tested tolerances and format limits.
 */
export const ENGINE_CAPABILITIES = Object.freeze({
  /** Exact supported transformation identifiers. */
  models: [
    "linear",
    "helmert",
    "polynomial1",
    "polynomial2",
    "polynomial3",
    "projective",
    "thinPlateSpline",
  ] as const,
  /** Supported byte-raster interpolation kernels. */
  resamplers: [
    "nearest",
    "bilinear",
    "cubic",
    "cubicSpline",
    "lanczos",
  ] as const,
  /**
   * Supported input encoding families; budgets apply independently of compressed size.
   */
  input: [
    "PNG uint8",
    "JPEG uint8 grayscale/RGB",
    "WebP static lossy/lossless RGB/RGBA",
    "TIFF single-page chunky uint8 grayscale/RGB/RGBA",
  ] as const,
  /** Core rendering returns raw RGBA; file encoders are optional plugins. */
  output: "RGBA raster; install export plugins for file formats",
  /** Minimum nondegenerate enabled TPS control points. */
  tpsMinimum: 3,
  /** Hard enabled-point fitting limit. */
  maxGcps: 128,
  /** False: this engine needs no WASM runtime or sidecar assets. */
  wasm: false,
  /** Abort strategy: terminate the dedicated operation worker. */
  cancellation: "dedicated-worker-termination",
  /** Datum-shift grid strategy; hosts supply NTv2 bytes explicitly. */
  datumGrids: "host-provided-ntv2",
});
/**
 * Image/alignment identity echoed on worker messages to reject results from obsolete
 * operations.
 */
export interface JobTag {
  /** Document that owns this operation. */
  documentId: string;
  /** Source image identity at submission. */
  imageId: string;
  /** Alignment revision at submission. */
  alignmentRevision: number;
}
/** Plugin-worker encoding request; its temporary raster buffer is transferred. */
export interface EncodeRequest {
  /** Encoding operation discriminator. */
  kind: "encode";
  /** Plugin encoder ID; must match the chosen worker. */
  format: string;
  /** Temporary full-resolution raster. Its buffer is detached on submission and returned in EngineResult.raster. */
  raster: Raster;
  /** Revisioned raster settings passed to the encoder. */
  output: OutputSettings;
  /** Serializable format options, such as JPEG quality/background. */
  options?: Record<string, unknown>;
}
/**
 * Worker operation discriminated by `kind`. Inspect reads identity and preview; normalize
 * creates a full-resolution PNG; fit converts GCP target CRSs; render warps pixels and
 * delegates optional encoding to plugin workers.
 */
export type EngineRequest =
  | EncodeRequest
  | {
      /**
       * Operation discriminator selecting inspection, normalization, fitting or
       * rendering.
       */
      kind: "inspect";
      /** Original local image bytes, retained independently of the document. */
      file: File;
    }
  | {
      /**
       * Operation discriminator selecting inspection, normalization, fitting or
       * rendering.
       */
      kind: "normalize";
      /** Original local image bytes, retained independently of the document. */
      file: File;
      /** Previously inspected identity and canonical image dimensions for these bytes. */
      metadata: ImageMetadata;
    }
  | {
      /**
       * Operation discriminator selecting inspection, normalization, fitting or
       * rendering.
       */
      kind: "fit";
      /** Paired points; each target is projected from its declared CRS before fitting. */
      gcps: Gcp[];
      /** Exact requested model; there is no model substitution. */
      model: Model;
      /** CRS for fitting and evaluating transformation coordinates. */
      workingCrs: string;
      /** Previously inspected identity and canonical image dimensions for these bytes. */
      metadata: ImageMetadata;
    }
  | {
      /**
       * Operation discriminator selecting inspection, normalization, fitting or
       * rendering.
       */
      kind: "render";
      /** Original local image bytes, retained independently of the document. */
      file: File;
      /** Previously inspected identity and canonical image dimensions for these bytes. */
      metadata: ImageMetadata;
      /** Validated fit in the declared working CRS for this image/alignment. */
      fit: Fit;
      /** CRS for fitting and evaluating transformation coordinates. */
      workingCrs: string;
      /** Explicit output CRS, bounds, resolution and encoding settings. */
      output: OutputSettings;
      /**
       * True for a reduced-resolution preview; false for raw full-resolution pixels. Encoding is a separate plugin job.
       */
      preview: boolean;
    };
/**
 * Operation-specific worker result. Only fields produced by the selected request kind are
 * present.
 */
export interface EngineResult {
  /** Inspected source metadata, returned by inspect. */
  metadata?: ImageMetadata;
  /** Orientation-normalized reduced PNG, returned by inspect. */
  imagePreview?: Blob;
  /** Validated numerical fit, returned by fit. */
  fit?: Fit;
  /** Warped RGBA pixels and georeferencing, returned by render. */
  raster?: Raster;
  /**
   * Full-resolution PNG for normalize, or plugin-encoded bytes for encode; absent for
   * preview renders.
   */
  blob?: Blob;
  /**
   * Worker processing time in milliseconds, excluding scheduler wait and worker startup.
   */
  elapsedMs: number;
}
/**
 * Processing interface for controllers and custom integrations. Implementation objects
 * and their resources are never serialized into sessions.
 */
export interface Engine {
  /**
   * Run one tagged operation. AbortSignal cancellation rejects with AbortError; other processing failures reject with structured errors.
   * @param request - Operation payload.
   * @param tag - Identity used to reject stale worker messages.
   * @param options - Cancellation and progress callbacks.
   * @returns Fields corresponding to the request kind.
   */
  run(
    request: EngineRequest,
    tag: JobTag,
    options?: EngineRunOptions,
  ): Promise<EngineResult>;
  /**
   * Cancel all active and queued jobs owned by this engine. The built-in engine permits
   * subsequent runs.
   */
  dispose(): void;
  /**
   * Effective workload limits, when known. Controllers use `maxGcps` to reject edits
   * beyond the engine budget before fitting; custom engines may omit this.
   */
  readonly limits?: Readonly<Limits>;
}
/** Cancellation/progress and optional per-operation plugin worker selection. */
export interface EngineRunOptions {
  /** Abort queued or running work, releasing its worker and scheduler slot. */
  signal?: AbortSignal;
  /** Progress fractions from zero to one. */
  onProgress?: (fraction: number) => void;
  /** Dedicated plugin worker factory; takes precedence over all worker URLs. */
  workerFactory?: () => Worker;
  /** Explicit plugin worker URL; overrides engine-level worker configuration. */
  workerUrl?: string | URL;
}
/**
 * Browser worker configuration. Construction is lazy; no assets are loaded until a job
 * runs.
 */
export interface EngineOptions {
  /**
   * Create a dedicated worker per operation for custom bundlers/CSP. Takes precedence
   * over workerUrl; returned workers are terminated after completion or cancellation.
   */
  workerFactory?: () => Worker;
  /**
   * Explicit deployed module-worker URL. Omit to resolve the bundled worker relative to
   * the engine module.
   */
  workerUrl?: string | URL;
  /**
   * Partial overrides of the default compressed-size, pixel and estimated-memory budgets.
   */
  limits?: Partial<Limits>;
  /** Host projection definitions copied into each worker realm. */
  definitions?: Definitions;
  /**
   * Host-provided NTv2 buffers copied into worker realms without detaching the originals.
   */
  datumGrids?: DatumGrids;
  /**
   * Optional shared host-owned FIFO scheduler bounding concurrent workers across engines.
   */
  scheduler?: JobScheduler;
}
/** Host-owned concurrency budget shared by any number of engine instances. */
export interface JobScheduler {
  /**
   * Wait for a slot, rejecting with AbortError if cancelled while queued. Returns an
   * idempotent release function; holders must release in finally.
   */
  acquire(signal?: AbortSignal): Promise<() => void>;
  /** Number of currently acquired, unreleased slots. */
  readonly running: number;
  /** Number of jobs waiting for a slot. */
  readonly pending: number;
}
/**
 * Create a bounded FIFO worker queue that removes cancelled work before allocation.
 * @param maxConcurrent - Positive integer capacity; defaults to 1.
 * @throws {@link "@georeferencing/core".GeoreferenceError} If capacity is not a positive integer.
 */
export function createJobScheduler(maxConcurrent = 1): JobScheduler {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1)
    throw new GeoreferenceError(
      "BUDGET",
      "Worker concurrency must be a positive integer.",
    );
  let running = 0;
  const queue: (() => void)[] = [];
  const drain = () => {
    while (running < maxConcurrent && queue.length) queue.shift()!();
  };
  return {
    get running() {
      return running;
    },
    get pending() {
      return queue.length;
    },
    acquire(signal) {
      return new Promise((resolve, reject) => {
        const cancel = () => {
          const index = queue.indexOf(start);
          if (index >= 0) queue.splice(index, 1);
          signal?.removeEventListener("abort", cancel);
          reject(new DOMException("Cancelled", "AbortError"));
        };
        const start = () => {
          signal?.removeEventListener("abort", cancel);
          if (signal?.aborted) {
            cancel();
            return;
          }
          running++;
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            running--;
            drain();
          });
        };
        if (signal?.aborted) {
          cancel();
          return;
        }
        queue.push(start);
        signal?.addEventListener("abort", cancel, { once: true });
        drain();
      });
    },
  };
}
/**
 * Create an SSR-safe engine that lazily starts one dedicated module worker per operation.
 *
 * Workers terminate on success, failure or abort. No SharedArrayBuffer, cross-origin isolation, WASM or raster backend is required. Configure workerFactory/workerUrl for deployments where the bundler cannot resolve the default relative worker URL.
 * @param options - Asset loading, projections and workload limits.
 * @returns Host-owned engine; call dispose when its consumers are finished.
 */
export function createWorkerEngine(options: EngineOptions = {}): Engine {
  const jobs = new Set<() => void>(),
    limits: Readonly<Limits> = Object.freeze({
      ...DEFAULT_LIMITS,
      ...options.limits,
    });
  return {
    limits,
    async run(request, tag, originalOptions = {}) {
      const abort = new AbortController(),
        cancelJob = () => abort.abort();
      if (originalOptions.signal?.aborted) cancelJob();
      originalOptions.signal?.addEventListener("abort", cancelJob, {
        once: true,
      });
      jobs.add(cancelJob);
      const runOptions = { ...originalOptions, signal: abort.signal };
      let release: (() => void) | undefined;
      try {
        release = await options.scheduler?.acquire(abort.signal);
        return await new Promise<EngineResult>((resolve, reject) => {
          if (runOptions.signal?.aborted) {
            reject(new DOMException("Cancelled", "AbortError"));
            return;
          }
          let worker: Worker;
          try {
            worker =
              runOptions.workerFactory?.() ??
              (runOptions.workerUrl
                ? new Worker(runOptions.workerUrl, { type: "module" })
                : undefined) ??
              options.workerFactory?.() ??
              (options.workerUrl
                ? new Worker(options.workerUrl, { type: "module" })
                : new Worker(new URL("./worker.js", import.meta.url), {
                    type: "module",
                  }));
          } catch (e) {
            reject(e);
            return;
          }
          const operationId = uid();
          let complete = false;
          const cleanup = () => {
            complete = true;
            worker.terminate();
            runOptions.signal?.removeEventListener("abort", cancel);
          };
          const cancel = () => {
            if (!complete) {
              cleanup();
              reject(new DOMException("Cancelled", "AbortError"));
            }
          };
          runOptions.signal?.addEventListener("abort", cancel, { once: true });
          // Worker load/startup failures are deployment problems that a retry cannot fix.
          worker.onerror = (e) => {
            cleanup();
            reject(
              new GeoreferenceError(
                "WORKER",
                e.message || "Worker failed; check worker URL and CSP.",
                false,
                operationId,
              ),
            );
          };
          worker.onmessageerror = () => {
            cleanup();
            reject(
              new GeoreferenceError(
                "WORKER",
                "A worker message could not be deserialized.",
                false,
                operationId,
              ),
            );
          };
          worker.onmessage = ({ data }) => {
            if (
              complete ||
              data.operationId !== operationId ||
              data.tag.documentId !== tag.documentId ||
              data.tag.imageId !== tag.imageId ||
              data.tag.alignmentRevision !== tag.alignmentRevision
            )
              return;
            if (data.progress !== undefined) {
              runOptions.onProgress?.(data.progress);
              return;
            }
            cleanup();
            if (data.error)
              reject(
                new GeoreferenceError(
                  data.error.code,
                  data.error.message,
                  data.error.recoverable !== false,
                  operationId,
                ),
              );
            else resolve(data.result);
          };
          try {
            worker.postMessage(
              {
                request,
                tag,
                operationId,
                limits,
                definitions: options.definitions ?? {},
                datumGrids: options.datumGrids ?? {},
              },
              request.kind === "encode"
                ? [request.raster.data.buffer as ArrayBuffer]
                : [],
            );
          } catch (error) {
            cleanup();
            reject(error);
          }
        });
      } finally {
        release?.();
        jobs.delete(cancelJob);
        originalOptions.signal?.removeEventListener("abort", cancelJob);
      }
    },
    dispose() {
      for (const cancel of [...jobs]) cancel();
    },
  };
}
