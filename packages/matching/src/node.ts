/**
 * Local image matching on owned Node.js worker threads, without a DOM or UI.
 * Callers decode and normalize images using their own image library.
 * @module @georeferencing/matching/node
 * @group @georeferencing/matching
 */
import { Worker } from "node:worker_threads";
import { createExecutor } from "./executor.js";
import type { ImageMatcher } from "./types.js";
/** Optional local asset override for the Node executor. */
export interface NodeMatcherOptions {
  /** Absolute local filesystem path to `opencv.wasm`; defaults to the packaged file. */
  wasmUrl?: string;
}
/**
 * Create a lazy Node 22.12+ matcher backed by a dedicated worker thread.
 *
 * Initialization occurs on the first match. Requests are cloned without detaching
 * caller buffers. Only one job may run at once; abort terminates synchronous WASM
 * work and the next job creates a fresh worker. Call `dispose()` on shutdown;
 * worker termination is requested immediately and completes asynchronously in Node.
 * No native OpenCV installation, React, browser canvas, or external service is used.
 *
 * @param options - Optional local WASM path; HTTP fetching is not supported here.
 * @returns The same result/progress/lifecycle contract as the browser executor.
 * @example
 * ```ts
 * const matcher = createNodeMatcher();
 * try {
 *   const result = await matcher.match({ query, reference });
 *   console.log(result.status, result.candidates);
 * } finally {
 *   matcher.dispose();
 * }
 * ```
 */
export function createNodeMatcher(
  options: NodeMatcherOptions = {},
): ImageMatcher {
  return createExecutor(() => {
    const worker = new Worker(new URL("./node-worker.js", import.meta.url));
    return {
      postMessage: (v) => worker.postMessage(v),
      terminate: () => {
        void worker.terminate();
      },
      listen(message, error) {
        worker.removeAllListeners("message");
        worker.removeAllListeners("error");
        worker.on("message", message);
        worker.on("error", error);
      },
    };
  }, options.wasmUrl);
}
