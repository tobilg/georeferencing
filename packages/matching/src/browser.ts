/**
 * Browser worker execution and pixel decoding for local image matching.
 *
 * Import this entry only in browser integrations. Creating a matcher does not
 * start a worker or load OpenCV; the first match does. This module supplies no UI.
 * @module @georeferencing/matching/browser
 * @group @georeferencing/matching
 */
import { createExecutor } from "./executor.js";
import type { ImageMatcher, PixelImage } from "./types.js";
/** Host-controlled worker and WASM asset locations for browser deployments. */
export interface BrowserMatcherOptions {
  /**
   * Create a dedicated module worker running the packaged `/worker` entry.
   * Defaults to a worker resolved relative to this module. The matcher owns and
   * terminates it on abort/disposal; the factory must return a new worker when
   * called again after cancellation. Do not return a shared application worker.
   */
  workerFactory?: () => Worker;
  /**
   * URL of the host-served `opencv.wasm` asset. Omit to use the packaged asset
   * beside `vendor/opencv.js`. Use an absolute URL when overriding so resolution
   * does not depend on the worker's location; no CDN is used by default.
   */
  wasmUrl?: string;
}
/**
 * Create a lazy, reusable browser-worker matcher with one active job at a time.
 *
 * Requests are cloned without transferring caller-owned buffers. Aborting a job
 * terminates the worker, including synchronous WASM work; a later job recreates
 * it. Successful jobs reuse the backend and its bounded reference-feature cache.
 * Always call `dispose()` when the owning application view is destroyed.
 *
 * @param options - Optional host worker factory and WASM URL.
 * @returns An executor following the shared `ImageMatcher` lifecycle contract.
 * @example
 * ```ts
 * const matcher = createBrowserMatcher();
 * try {
 *   const result = await matcher.match({ query, reference }, { signal });
 *   // Render result.candidates in your own UI; matching never applies points.
 * } finally {
 *   matcher.dispose();
 * }
 * ```
 */
export function createBrowserMatcher(
  options: BrowserMatcherOptions = {},
): ImageMatcher {
  return createExecutor(() => {
    const worker =
      options.workerFactory?.() ??
      new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    return {
      postMessage: (v) => worker.postMessage(v),
      terminate: () => worker.terminate(),
      listen(message, error) {
        worker.onmessage = (e) => message(e.data);
        worker.onerror = (e) => error(new Error(e.message));
      },
    };
  }, options.wasmUrl);
}
/**
 * Decode an already orientation-normalized image blob into packed RGBA pixels.
 *
 * Uses `createImageBitmap` and `OffscreenCanvas`; both must be available in the
 * calling browser context. Temporary bitmap/canvas resources are released before
 * returning. This helper imposes no size budget: validate encoded/decoded limits
 * before decoding untrusted or large images. For uploads, use the existing core
 * controller's `getNormalizedImage()` so coordinates match its source image.
 *
 * @param blob - Decodable reference image or normalized query blob.
 * @returns Caller-owned bytes with top-left pixel-edge origin and Y downward.
 * @throws Browser decode or canvas errors for unsupported/invalid image data.
 */
export async function decodeReferenceImage(blob: Blob): Promise<PixelImage> {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  try {
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    return {
      width: bitmap.width,
      height: bitmap.height,
      data: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data,
    };
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}
